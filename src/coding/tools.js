const { AITool } = require("../ai/tools");
const brain = require("./CodingBrain");

/**
 * Tool AI Coding Brain — Aether memanggil "mesin internal" lewat sini.
 *
 * Fase 1: mesin GRAF (Graphify). Aturan (ditegakkan lewat deskripsi):
 * SEBELUM membuat patch, pahami dulu hubungan antar-file/simbol dengan
 * graf — jangan menebak. Hemat: satu query graf mengembalikan subgraf
 * terscope, jauh lebih kecil dari membaca banyak file.
 */
function codingTools() {

    const graph = brain.graph;

    return [

        new AITool({
            name: "code_graph_query",
            description:
                "Cari file/simbol RELEVAN untuk sebuah tugas lewat graph proyek (dependency/" +
                "call/import). Pakai ini DULU sebelum membaca file atau membuat patch, agar " +
                "tahu apa yang saling terhubung. Balikan = subgraf terscope (node + edge).",
            parameters: {
                type: "object",
                properties: {
                    question: { type: "string", description: "Pertanyaan bahasa alami, mis. 'di mana konektor OpenClaw dipakai?'." },
                    project: { type: "string", description: "Path root proyek (opsional; default proyek daemon)." }
                },
                required: ["question"]
            },
            execute: async ({ question, project }) => {
                if (!graph.hasGraph(project)) {
                    return { ok: false, note: "Proyek belum punya graph (graphify-out/graph.json). Bangun dulu: graphify extract/update." };
                }
                return { ok: true, result: await graph.query(question, { project }) };
            }
        }),

        new AITool({
            name: "code_graph_path",
            description:
                "Tampilkan JALUR hubungan antara dua simbol/konsep A→B (bagaimana keduanya " +
                "terkait via pemanggilan/impor). Pakai untuk memahami dampak sebuah perubahan.",
            parameters: {
                type: "object",
                properties: {
                    from: { type: "string", description: "Simbol/konsep asal." },
                    to: { type: "string", description: "Simbol/konsep tujuan." },
                    project: { type: "string", description: "Path root proyek (opsional)." }
                },
                required: ["from", "to"]
            },
            execute: async ({ from, to, project }) => ({ ok: true, result: await graph.path(from, to, { project }) })
        }),

        new AITool({
            name: "code_graph_explain",
            description:
                "Penjelasan terfokus sebuah konsep/simbol dari graph (definisi + tetangga " +
                "terpenting). Lebih ringkas dari membaca seluruh file.",
            parameters: {
                type: "object",
                properties: {
                    concept: { type: "string", description: "Nama simbol/konsep yang ingin dipahami." },
                    project: { type: "string", description: "Path root proyek (opsional)." }
                },
                required: ["concept"]
            },
            execute: async ({ concept, project }) => ({ ok: true, result: await graph.explain(concept, { project }) })
        }),

        new AITool({
            name: "code_graph_update",
            description:
                "Segarkan graph proyek setelah kode diubah (AST-only, tanpa biaya API). " +
                "Panggil setelah membuat patch agar analisis berikutnya akurat.",
            parameters: {
                type: "object",
                properties: { project: { type: "string", description: "Path root proyek (opsional)." } }
            },
            execute: async ({ project }) => { await graph.update(project); return { ok: true, updated: true }; }
        }),

        // ---- Mesin SIMBOL (Serena, Fase 2) ---------------------------

        new AITool({
            name: "code_symbol_index",
            description:
                "Bangun/segarkan cache SIMBOL proyek (Serena/LSP) agar navigasi simbol " +
                "cepat & akurat. Jalankan sekali per proyek (atau setelah perubahan besar) " +
                "sebelum mengandalkan analisis simbol.",
            parameters: {
                type: "object",
                properties: { project: { type: "string", description: "Path root proyek (opsional)." } }
            },
            execute: async ({ project }) => {
                if (!await brain.symbol.available()) return { ok: false, note: "Serena belum terpasang." };
                return brain.symbol.index(project);
            }
        }),

        new AITool({
            name: "code_symbol_health",
            description: "Diagnosa kesiapan proyek untuk analisis simbol (Serena health-check).",
            parameters: {
                type: "object",
                properties: { project: { type: "string", description: "Path root proyek (opsional)." } }
            },
            execute: async ({ project }) => {
                if (!await brain.symbol.available()) return { ok: false, note: "Serena belum terpasang." };
                return brain.symbol.healthCheck(project);
            }
        }),

        // ---- Mesin AST (Tree-sitter, Fase 3) -------------------------

        new AITool({
            name: "code_ast_outline",
            description:
                "Outline SIMBOL sebuah file/potongan kode dari AST Tree-sitter (kelas/fungsi/" +
                "method/interface + baris & kedalaman). Sumber kebenaran struktur kode — pakai " +
                "ini alih-alih menebak/regex saat perlu memahami isi satu file. Beri `file` " +
                "(path) ATAU `code`+`lang`.",
            parameters: {
                type: "object",
                properties: {
                    file: { type: "string", description: "Path file (mis. src/x.js). Diprioritaskan." },
                    code: { type: "string", description: "Potongan kode langsung (butuh 'lang')." },
                    lang: { type: "string", description: "Bahasa/ekstensi untuk 'code' (js/ts/py/go/rs/…)." }
                }
            },
            execute: async ({ file, code, lang }) => {
                if (!await brain.ast.available()) return { ok: false, note: "Tree-sitter belum terpasang." };
                const r = file ? await brain.ast.symbolsOfFile(file)
                    : await brain.ast.symbols(String(code ?? ""), lang ?? "js");
                return { ok: true, ...r };
            }
        }),

        // ---- Loop eksekusi: patcher + tester + bug-memory ------------

        new AITool({
            name: "code_recall_fixes",
            description:
                "INGAT perbaikan bug lampau yang mirip gejala INI sebelum investigasi baru " +
                "(hemat tool budget — jangan ulangi kerja). Balikan: Root Cause/Patch/File/" +
                "Lesson dari memori. Panggil paling awal saat menghadapi bug.",
            parameters: {
                type: "object",
                properties: { symptom: { type: "string", description: "Gejala/pesan error/tugas." } },
                required: ["symptom"]
            },
            execute: async ({ symptom }) => brain.bugMemory.recall(symptom)
        }),

        new AITool({
            name: "code_test",
            description:
                "Jalankan verifikasi proyek (lint+test dari package.json; skip yang tak ada). " +
                "Gerbang WAJIB setelah menambal — jangan anggap selesai sebelum ini hijau. " +
                "Balikan { ok, failed?, steps } berisi output untuk diagnosa.",
            parameters: {
                type: "object",
                properties: {
                    project: { type: "string", description: "Path root proyek (opsional)." },
                    steps: { type: "array", items: { type: "string" }, description: "Urutan script, default ['lint','test']." }
                }
            },
            execute: async ({ project, steps }) => brain.tester.verify(project, steps ? { steps } : undefined)
        }),

        new AITool({
            name: "code_check_syntax",
            description: "Cek sintaks satu file JS tanpa mengeksekusinya (node --check). Cepat, dipakai setelah edit.",
            parameters: {
                type: "object",
                properties: { file: { type: "string", description: "Path file .js/.cjs/.mjs." } },
                required: ["file"]
            },
            execute: async ({ file }) => brain.tester.check(file)
        }),

        new AITool({
            name: "code_branch",
            description:
                "Buat BRANCH git kerja SEBELUM menambal (patch aman & bisa dibuang). Wajib " +
                "sebelum mengubah kode pada tugas non-sepele.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Nama branch, mis. 'aether/fix-openclaw-404'." },
                    project: { type: "string", description: "Path root proyek (opsional)." }
                },
                required: ["name"]
            },
            execute: async ({ name, project }) => {
                if (!await brain.patcher.isRepo(project)) return { ok: false, note: "Bukan repo git." };
                return brain.patcher.createBranch(name, project);
            }
        }),

        new AITool({
            name: "code_commit",
            description: "Commit perubahan SETELAH test hijau (stage semua). Kembalikan hasil commit.",
            parameters: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Pesan commit (imperatif, ringkas)." },
                    project: { type: "string", description: "Path root proyek (opsional)." }
                },
                required: ["message"]
            },
            execute: async ({ message, project }) => brain.patcher.commit(message, project)
        }),

        new AITool({
            name: "code_rollback",
            description:
                "ROLLBACK aman: buang perubahan belum-commit (kembalikan file ke HEAD) bila " +
                "test gagal. Bukan reset destruktif. Beri daftar file, atau kosong = semua.",
            parameters: {
                type: "object",
                properties: {
                    files: { type: "array", items: { type: "string" }, description: "File yang dikembalikan; kosong = semua." },
                    project: { type: "string", description: "Path root proyek (opsional)." }
                }
            },
            execute: async ({ files, project }) => brain.patcher.restore(files, project)
        }),

        new AITool({
            name: "code_remember_fix",
            description:
                "SIMPAN pengalaman perbaikan setelah test hijau (Root Cause/Patch/File/Lesson) " +
                "agar bug serupa cepat selesai lain kali. Panggil di akhir setiap perbaikan.",
            parameters: {
                type: "object",
                properties: {
                    symptom: { type: "string", description: "Gejala awal." },
                    file: { type: "string", description: "File utama yang diubah." },
                    rootCause: { type: "string", description: "Akar masalah sebenarnya." },
                    patch: { type: "string", description: "Ringkas patch yang menyelesaikan." },
                    lesson: { type: "string", description: "Pelajaran agar tak terulang." }
                },
                required: ["rootCause", "lesson"]
            },
            execute: async (exp) => brain.bugMemory.record(exp)
        })

    ];
}

module.exports = { codingTools };
