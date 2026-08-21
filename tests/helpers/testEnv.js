const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Pemasangan lingkungan untuk seluruh berkas tes.
 *
 * Dimuat lewat `--require` sebelum berkas tes mana pun dijalankan,
 * karena setiap berkas tes berjalan di prosesnya sendiri: mengatur
 * ini di satu berkas tidak melindungi berkas lainnya.
 *
 * Tanpa ini, tes yang menyentuh `toolGuard` menulis peristiwa palsu
 * ke jejak audit sungguhan. Jejak audit yang tercampur data tes
 * tidak dapat dipercaya justru saat dibutuhkan untuk menelusuri
 * kejadian nyata — dan itu menghapus seluruh gunanya.
 */

if (!process.env.AETHER_AUDIT_DIR) {
    process.env.AETHER_AUDIT_DIR =
        fs.mkdtempSync(path.join(os.tmpdir(), "aether-audit-test-"));
}

// Basis memori juga. Tes buildMemory sempat menitipkan 9 catatan
// palsu ke memori sungguhan, dan karena memori disuntikkan ke
// system prompt, catatan "Area: uji" itu benar-benar muncul sebagai
// konteks saat pengguna menyapa Aether.
if (!process.env.AETHER_MEMORY_DB) {
    process.env.AETHER_MEMORY_DB = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "aether-memdb-test-")),
        "memory.db"
    );
}

// Basis sesi percakapan kanal (src/channels) juga diisolasi — tes
// kanal tidak boleh menulis ke data/channels.db sungguhan.
if (!process.env.AETHER_CHANNEL_DB) {
    process.env.AETHER_CHANNEL_DB = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "aether-chandb-test-")),
        "channels.db"
    );
}

process.on("exit", () => {

    for (const jalur of [
        process.env.AETHER_AUDIT_DIR,
        process.env.AETHER_MEMORY_DB && path.dirname(process.env.AETHER_MEMORY_DB),
        process.env.AETHER_CHANNEL_DB && path.dirname(process.env.AETHER_CHANNEL_DB)
    ]) {
        try {
            if (jalur && /aether-(audit|memdb|chandb)-test-/.test(jalur)) {
                fs.rmSync(jalur, { recursive: true, force: true });
            }
        }
        catch { /* biarkan OS yang membersihkan */ }
    }

});
