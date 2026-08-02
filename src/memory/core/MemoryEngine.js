const memory = require("../services/MemoryService");
const store = require("../stores/MemoryStore");
const edges = require("../graph/EdgeStore");
const types = require("./types");
const stm = require("../stm/WorkingSet");

/**
 * MemoryEngine — pintu tunggal Memory Engine Aether (Aether Core).
 *
 * Subsistem 1 (Memory Core): facade ADITIF di atas MemoryService yang
 * sudah ada. Menyatukan akses + membawa konteks penulis (writer/role/
 * scope) + taksonomi tipe. TIDAK mengubah skema/DB & tidak mengubah
 * perilaku: tulis masih commit langsung. Gerbang persetujuan
 * (proposal→approve), STM, KG, retrieval-planner, dst. ditambah di
 * subsistem berikutnya lewat facade ini — bukan dengan menyentuh
 * penyimpanan langsung.
 *
 * Aturan kepemilikan: SEMUA penulis (Planner, Runtime, Skill, OpenClaw,
 * Hermes, Ponytail) kelak menulis lewat facade ini — memori milik
 * Aether Core, bukan runtime lain.
 */
class MemoryEngine {

    /** Bungkus konteks pemanggil (siapa yang menulis/membaca). */
    context({ writer = "aether", role = "superadmin", scope = null } = {}) {
        return { writer, role, scope };
    }

    /** Taksonomi tipe memori (untuk UI/introspeksi). */
    types() {
        return types.list();
    }

    // ---- Baca (delegasi ke pipeline recall yang ada) -------------

    recall(query, opts) { return memory.recall(query, opts); }
    search(query, opts) { return memory.recall(query, opts); }
    buildContext(query, opts) { return memory.buildContext(query, opts); }
    stats() { return memory.stats(); }

    // ---- Short-Term Memory (subsistem 2) -------------------------
    // Working set dalam-proses; bebas ditulis (tak butuh persetujuan).

    get stm() { return stm; }

    /** Catat kejadian ke STM. scope diambil dari ctx.scope bila ada. */
    observe(scopeOrCtx, event) {
        const scope = (scopeOrCtx && typeof scopeOrCtx === "object") ? scopeOrCtx.scope : scopeOrCtx;
        return stm.observe(scope, event);
    }

    // ---- Long-Term Memory (subsistem 3) --------------------------
    // Substrat durabel = MemoryStore: supersede-not-delete, bi-temporal
    // (occurred_at/valid_until). Facade menyediakan akses baca +
    // "forget" LUNAK (kedaluwarsakan, bukan hapus) demi aturan:
    // JANGAN pernah menghapus memori tanpa persetujuan eksplisit.

    ltmGet(id) { return store.get(id); }
    ltmList(opts) { return store.list(opts); }

    /** Lupakan lunak: set valid_until=now agar hilang dari recall, data tetap. */
    async forget(id) {
        return store.update(id, { validUntil: new Date().toISOString() });
    }

    // ---- Knowledge Graph (subsistem 4) ---------------------------
    // Sisi bi-temporal. link/unlink kelak dapat dialihkan ke PROPOSAL
    // untuk penulis non-Aether lewat Governance (subsistem 7).

    get edges() { return edges; }
    link(edge) { return edges.link(edge); }
    unlink(edge) { return edges.unlink(edge); }
    neighbors(node, opts) { return edges.neighbors(node, opts); }

    // ---- Tulis ---------------------------------------------------
    // Subsistem 1: commit langsung (perilaku sekarang dipertahankan).
    // Subsistem 7 (Governance) akan mengalihkan tipe ber-tier "ask"
    // menjadi PROPOSAL, bukan commit — lewat facade yang sama.

    async remember(content, { type = "semantic", importance, entities = [], metadata = {}, sensitive } = {}, ctx = {}) {
        const key = types.resolve(type);
        const spec = types.spec(key);
        return memory.remember({
            content,
            type: spec.storeType,
            source: ctx.writer || "aether",
            importance: importance ?? (spec.sensitive ? 0.8 : 0.6),
            sensitive: sensitive ?? spec.sensitive,
            entities,
            metadata: { ...metadata, memoryType: key, scope: ctx.scope ?? metadata.scope ?? null }
        });
    }

}

module.exports = new MemoryEngine();
