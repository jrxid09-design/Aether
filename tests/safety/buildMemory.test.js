const test = require("node:test");
const assert = require("node:assert");

const buildMemory = require("../../src/memory/buildMemory");

/**
 * Ingatan Aether tentang dirinya sendiri.
 *
 * Menyentuh basis data memori yang sungguhan — sama seperti
 * bugMemory. Catatan uji diberi penanda unik supaya tidak tertukar
 * dengan jurnal rekayasa yang asli.
 */

const tanda = `UJIBUILD${Date.now()}`;

test("catatan tanpa alasan DITOLAK", async () => {

    // `why` adalah bagian yang tak bisa dibaca ulang dari git.
    // Catatan tanpa itu hanya mengulang apa yang sudah ada di riwayat.
    const r = await buildMemory.record({
        area: "uji",
        change: `perubahan ${tanda}`
    });

    assert.equal(r.ok, false);
    assert.match(r.note, /why/);

});

test("catatan tanpa perubahan DITOLAK", async () => {

    const r = await buildMemory.record({ why: "alasan saja tidak cukup" });

    assert.equal(r.ok, false);

});

test("keputusan rekayasa tersimpan dan dapat diingat kembali", async () => {

    const simpan = await buildMemory.record({
        area: "uji",
        change: `menaikkan ambang ${tanda}`,
        why: `karena kemampuan yang sama tidak boleh punya dua tingkat izin ${tanda}`,
        files: ["src/uji/berkas.js"],
        verification: "dibuktikan lewat tes",
        risks: "belum diamati di produksi"
    });

    assert.equal(simpan.ok, true);
    assert.ok(simpan.id, "harus mengembalikan id");

    const ingat = await buildMemory.recall(`menaikkan ambang ${tanda}`);

    assert.ok(ingat.count >= 1, "catatan build harus ditemukan");
    assert.ok(
        ["kuat", "sedang"].includes(ingat.confidence),
        `kecocokan langsung harusnya tidak lemah, dapat "${ingat.confidence}"`
    );

    const isi = ingat.notes.map(n => n.content).join("\n");

    assert.match(isi, new RegExp(tanda), "isi yang benar dikembalikan");
    assert.match(isi, /Alasan:/, "alasan ikut tersimpan — bagian yang paling berharga");

});

test("berkas terkait ikut terbawa", async () => {

    const ingat = await buildMemory.recall(`menaikkan ambang ${tanda}`);
    const catatan = ingat.notes.find(n => n.content.includes(tanda));

    assert.ok(catatan, "catatan uji harus ada");
    assert.deepEqual(catatan.files, ["src/uji/berkas.js"]);
    assert.equal(catatan.area, "uji");

});

test("hasil TIDAK PERNAH disajikan sebagai kepastian", async () => {

    // Tidak ada ambang yang memisahkan relevan dari tidak di
    // tumpukan ini — dua percobaan menunjukkan skor total bergeser
    // mengikuti korpus, keywordScore nol pada korpus kecil (IDF
    // BM25), dan skor vektor tumpang tindih. Maka yang wajib ada
    // bukan penyaringan, melainkan peringatan dan bukti.
    for (const kueri of [
        "zxqw plumbus fnord kalabatu 99812",
        "topik yang tak pernah ada sama sekali",
        "kenapa terminal_run diblokir"
    ]) {

        const ingat = await buildMemory.recall(kueri);

        assert.ok(["kuat", "sedang", "lemah", "tidak ada"].includes(ingat.confidence));

        if (ingat.count > 0) {
            assert.match(ingat.note, /MUNGKIN relevan/, `"${kueri}" tidak boleh disajikan sebagai pasti`);
            assert.match(ingat.note, /katakan tidak tahu/i, "model harus diberi izin mengaku tidak tahu");
            assert.equal(typeof ingat.notes[0].kata, "number", "skor kata ikut agar dapat dinilai");
            assert.equal(typeof ingat.notes[0].makna, "number", "skor makna ikut agar dapat dinilai");
        }

    }

});

test("memori kosong mengaku tidak tahu", async () => {

    const ingat = await buildMemory.recall("apa pun");

    if (ingat.count === 0) {
        assert.equal(ingat.confidence, "tidak ada");
        assert.match(ingat.note, /tidak tahu/);
    }

});

test("catatan bergaya jurnal dapat ditemukan lewat pertanyaan wajar", async () => {

    // Menyemai sendiri, tidak menumpang jurnal produksi: tes ini
    // dulu membaca memori sungguhan, dan tes-tes di berkas ini
    // sempat menitipkan 9 catatan palsu ke sana. Karena memori
    // disuntikkan ke system prompt, catatan "Area: uji" itu benar-
    // benar muncul sebagai konteks saat pengguna menyapa Aether.
    await buildMemory.record({
        area: "keselamatan",
        change: `terminal_run diklasifikasikan destruktif ${tanda}`,
        why: "menjalankan perintah sembarang; kemampuan yang sama tidak boleh punya dua tingkat izin",
        files: ["src/core/safety/riskCatalog.js"],
        verification: "ditolak SAFETY_RISK_BLOCKED pada daemon berjalan"
    });

    const ingat = await buildMemory.recall("kenapa terminal_run diblokir");

    assert.ok(ingat.count >= 1, "keputusan terminal_run harus dapat diingat");

    const isi = ingat.notes.map(n => n.content).join("\n").toLowerCase();

    assert.match(isi, /terminal_run/);
    assert.match(isi, /alasan:/, "alasannya ikut, bukan cuma daftar perubahan");

});

test("jurnal rekayasa TIDAK disuntikkan ke percakapan biasa", async () => {

    // Terukur pada sistem sungguhan: sapaan "Halo" menarik catatan
    // build tentang sebuah berkas sumber ke dalam system prompt.
    // Konteks itu tak berguna bagi pengguna dan di mesin lokal
    // dibayar dengan detik. Tersedia sesuai permintaan lewat
    // build_recall, bukan diselipkan diam-diam.
    const MemoryService = require("../../src/memory/services/MemoryService");

    await buildMemory.record({
        area: "runtime",
        change: `catatan yang seharusnya tidak menyapa siapa pun ${tanda}`,
        why: "hanya relevan saat ditanya soal rekayasa"
    });

    const ctx = await MemoryService.buildContext(
        `catatan yang seharusnya tidak menyapa siapa pun ${tanda}`,
        { limit: 8, maxChars: 1800 }
    );

    assert.ok(
        !String(ctx.text ?? "").includes(tanda),
        "catatan build tidak boleh masuk ke konteks percakapan"
    );

});
