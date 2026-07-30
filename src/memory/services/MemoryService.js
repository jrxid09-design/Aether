const { initialize, database } = require("../db");

const MemoryStore = require("../stores/MemoryStore");
const EntityStore = require("../stores/EntityStore");
const DocumentStore = require("../stores/DocumentStore");
const EmbeddingStore = require("../stores/EmbeddingStore");

const EmbeddingService = require("./EmbeddingService");
const RecallService = require("./RecallService");

const telemetry = require("../../services/telemetryService");

const { truncate } = require("../util/text");

/**
 * Muka depan lapisan memori.
 *
 * Semua bagian lain Aether — controller HTTP, tool AI, kelak
 * penerima event CCTV/sensor — cukup bicara ke kelas ini dan tidak
 * perlu tahu soal FTS, vektor, atau resolusi entitas.
 */
class MemoryService {

    constructor() {

        this.started = false;

        this.backfillTimer = null;

    }

    async start({ backfillInterval = 60000 } = {}) {

        if (this.started) {
            return this;
        }

        await initialize();

        this.started = true;

        // Embedding diisi di latar belakang: memori yang masuk saat
        // Ollama mati tetap tercatat, vektornya menyusul.
        this.backfillTimer = setInterval(() => {

            EmbeddingService.backfill().catch(error => {
                telemetry.warn(`[memory] backfill gagal: ${error.message}`);
            });

        }, backfillInterval);

        this.backfillTimer.unref?.();

        telemetry.info("[memory] lapisan memori siap");

        return this;

    }

    stop() {

        if (this.backfillTimer) {
            clearInterval(this.backfillTimer);
            this.backfillTimer = null;
        }

        this.started = false;

        return this;

    }

    /**
     * Catat satu memori.
     *
     * `entities` boleh berisi nama ("ayah", "Garasi") — nama akan
     * di-resolve atau dibuat, sehingga pemanggil tidak perlu tahu
     * id internal.
     */
    async remember({
        content,
        type = "episodic",
        source = "system",
        sourceRef = null,
        importance = 0.5,
        confidence = 1,
        occurredAt = null,
        validUntil = null,
        sensitive = false,
        pinned = false,
        metadata = {},
        documentId = null,
        entities = [],
        supersedes = null
    }) {

        await this.start();

        const memory = await MemoryStore.insert({
            type, content, source, sourceRef, importance, confidence,
            occurredAt, validUntil, sensitive, pinned, metadata, documentId
        });

        const linked = [];

        for (const mention of entities) {

            const spec = typeof mention === "string"
                ? { name: mention }
                : mention;

            if (!spec?.name) {
                continue;
            }

            const entity = await EntityStore.resolveOrCreate(spec.name, {
                kind: spec.kind,
                attributes: spec.attributes,
                occurredAt: occurredAt ?? undefined
            });

            await MemoryStore.linkEntities(memory.id, [{
                entityId: entity.id,
                role: spec.role ?? "mentions"
            }]);

            linked.push(entity);

        }

        if (supersedes) {
            await MemoryStore.supersede(supersedes, memory.id);
        }

        // Coba embed langsung; kalau Ollama mati, backfill yang urus.
        if (!memory.reinforced) {
            await EmbeddingService.embedMemory(memory).catch(() => false);
        }

        telemetry.publish("memory:remembered", {
            id: memory.id,
            type: memory.type,
            source: memory.source,
            reinforced: memory.reinforced,
            preview: truncate(memory.content, 90)
        });

        return { ...memory, entities: linked };

    }

    async recall(query, options = {}) {

        await this.start();

        return RecallService.recall(query, options);

    }

    /**
     * Rangkai memori relevan menjadi blok teks siap tempel ke
     * system prompt.
     *
     * Dibatasi jumlah karakter, bukan jumlah item, karena yang
     * langka adalah konteks model — bukan barisnya.
     */
    async buildContext(query, {
        limit = 8,
        maxChars = 1800,
        includeDocuments = true
    } = {}) {

        const result = await this.recall(query, { limit, includeDocuments });

        const lines = [];

        let used = 0;

        for (const item of result.items) {

            const when = (item.occurredAt ?? "").slice(0, 16).replace("T", " ");

            const who = item.entities.length
                ? ` [${item.entities.map(entity => entity.name).join(", ")}]`
                : "";

            const line = `- (${item.type}, ${when})${who} ${item.content}`;

            if (used + line.length > maxChars) {
                break;
            }

            lines.push(line);

            used += line.length;

        }

        const documentLines = [];

        for (const doc of result.documents ?? []) {

            const line = `- [${doc.title ?? doc.uri}${
                doc.heading ? ` › ${doc.heading}` : ""
            }] ${doc.excerpt}`;

            if (used + line.length > maxChars) {
                break;
            }

            documentLines.push(line);

            used += line.length;

        }

        const sections = [];

        if (lines.length) {
            sections.push(`Memori relevan:\n${lines.join("\n")}`);
        }

        if (documentLines.length) {
            sections.push(`Kutipan dokumen:\n${documentLines.join("\n")}`);
        }

        return {
            text: sections.join("\n\n"),
            memoryCount: lines.length,
            documentCount: documentLines.length,
            entities: result.entities,
            strategies: result.strategies
        };

    }

    async forget(id) {

        await this.start();

        const removed = await MemoryStore.remove(id);

        if (removed) {

            await database.run(
                "DELETE FROM embeddings WHERE owner_kind = 'memory' AND owner_id = ?",
                [id]
            );

            telemetry.publish("memory:forgotten", { id });

        }

        return removed;

    }

    async update(id, patch) {

        await this.start();

        const memory = await MemoryStore.update(id, patch);

        // Isi berubah berarti vektor lama tidak lagi mewakili.
        if (patch.content) {

            await database.run(
                "DELETE FROM embeddings WHERE owner_kind = 'memory' AND owner_id = ?",
                [id]
            );

            await EmbeddingService.embedMemory(memory).catch(() => false);

        }

        return memory;

    }

    async list(options) {

        await this.start();

        return MemoryStore.list(options);

    }

    async get(id) {

        await this.start();

        const memory = await MemoryStore.get(id);

        if (!memory) {
            return null;
        }

        return {
            ...memory,
            entities: await MemoryStore.entitiesOf(id)
        };

    }

    /**
     * Perawatan berkala.
     *
     * Tujuannya menjaga memori tetap berguna, bukan sekadar kecil:
     * fakta kedaluwarsa ditandai, memori tak penting yang tak pernah
     * dipanggil meluruh, dan sisanya dibiarkan.
     */
    async consolidate({ dryRun = false, decayAfterDays = 90 } = {}) {

        await this.start();

        const expired = await database.all(
            `SELECT id FROM memories
             WHERE valid_until IS NOT NULL
               AND valid_until <= datetime('now')
               AND superseded_by IS NULL
               AND pinned = 0`
        );

        const stale = await database.all(
            `SELECT id FROM memories
             WHERE pinned = 0
               AND sensitive = 0
               AND recall_count = 0
               AND importance < 0.35
               AND type = 'episodic'
               AND occurred_at < datetime('now', ?)`,
            [`-${Number(decayAfterDays)} days`]
        );

        if (dryRun) {

            return {
                dryRun: true,
                expired: expired.length,
                stale: stale.length
            };

        }

        let removed = 0;

        for (const row of stale) {

            if (await this.forget(row.id)) {
                removed++;
            }

        }

        // Memori kedaluwarsa tidak dihapus — ia tetap fakta historis
        // yang sah, hanya tidak lagi dipakai sebagai keadaan kini.
        // Penurunan importance membuatnya tenggelam secara alami.
        if (expired.length) {

            await database.run(
                `UPDATE memories
                 SET importance = max(0.05, importance - 0.2)
                 WHERE id IN (${expired.map(() => "?").join(",")})`,
                expired.map(row => row.id)
            );

        }

        telemetry.info(
            `[memory] konsolidasi: ${removed} dihapus, ${expired.length} kedaluwarsa diturunkan`
        );

        return { removed, expired: expired.length };

    }

    async stats() {

        await this.start();

        return {
            memories: await MemoryStore.stats(),
            entities: await EntityStore.stats(),
            documents: await DocumentStore.stats(),
            embeddings: await EmbeddingService.status(),
            database: require("../db").file
        };

    }

}

module.exports = new MemoryService();
