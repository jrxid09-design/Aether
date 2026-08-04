const graph = require("./graph/graphifyAdapter");

/**
 * CodingBrain — pintu tunggal kemampuan software-engineering Aether.
 *
 * Aether (orchestrator) tetap otak utama; CodingBrain menyatukan "mesin
 * internal" (Graphify/Serena/Tree-sitter/LSP/Memory) di balik satu facade
 * modular. Diisi bertahap:
 *   graph    (Graphify)     — hubungan antar-file/simbol   ✔ Fase 1
 *   symbol   (Serena)       — cari/rename/refs             ⏳ Fase 2
 *   ast      (Tree-sitter)  — sumber kebenaran AST         ⏳ Fase 3
 *   lsp                     — defs/refs/diagnostics        ⏳ Fase 4
 *   memory   (MemoryEngine) — pengalaman bug + arsitektur  ⏳ Fase 5
 *   planner/patcher/tester                                 ⏳ Fase 6-8
 */
class CodingBrain {
    get graph() { return graph; }

    /** Ringkas mesin mana yang siap dipakai (untuk introspeksi/UI). */
    async capabilities() {
        return {
            graph: await graph.available(),
            symbol: false,   // Serena — Fase 2
            ast: false,      // Tree-sitter — Fase 3
            lsp: false,      // Fase 4
            memory: true     // MemoryEngine sudah ada
        };
    }
}

module.exports = new CodingBrain();
