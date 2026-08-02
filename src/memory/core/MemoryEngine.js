const memory = require("../services/MemoryService");
const types = require("./types");

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
