const path = require("node:path");
const crypto = require("node:crypto");
const JsonStore = require("../core/config/JsonStore");
const telemetry = require("./telemetryService");

/**
 * familyLocationService — Berbagi Lokasi Keluarga (opt-in, gaya Find My).
 *
 * BUKAN pelacakan nomor telepon. Tiap anggota didaftarkan dan diberi
 * SATU share-token; perangkat anggota memasang token itu dan MENGIRIM
 * lokasinya sendiri secara berkala. Tanpa token milik perangkat itu,
 * tak ada lokasi yang bisa masuk — persetujuan melekat pada kepemilikan
 * token. Anggota bisa dicabut kapan saja (token mati).
 *
 * Data disimpan lokal di configs/family-location.json (gitignored).
 */

const FILE = process.env.AETHER_FAMILY_LOCATION_FILE
    || path.join(__dirname, "..", "..", "configs", "family-location.json");

const store = new JsonStore(FILE, { members: {} });

/** Validasi koordinat (pure). */
function validCoord(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function publicView(m) {
    return {
        id: m.id, name: m.name, consent: m.consent,
        location: m.location || null, updatedAt: m.updatedAt || null,
        // token TIDAK pernah ikut ditampilkan.
        sharing: Boolean(m.location)
    };
}

class FamilyLocationService {

    /** Daftarkan anggota (dengan persetujuannya). Token dikembalikan SEKALI. */
    register({ name } = {}) {
        const nm = String(name || "").trim();
        if (!nm) throw new Error("Nama anggota wajib diisi.");
        const data = store.read();
        const id = "m_" + crypto.randomBytes(4).toString("hex");
        const token = crypto.randomBytes(24).toString("hex");
        const members = { ...data.members, [id]: { id, name: nm, token, consent: true, location: null, createdAt: new Date().toISOString() } };
        store.write({ members });
        telemetry.info(`[family-location] anggota didaftarkan: ${nm}`);
        // Token hanya di sini — dipasang di perangkat anggota, lalu tak ditampilkan lagi.
        return { id, name: nm, shareToken: token };
    }

    /** Perangkat anggota mengirim lokasinya sendiri (auth via token). */
    update(token, { lat, lng, accuracy = null, battery = null } = {}) {
        const t = String(token || "");
        if (!t) throw new Error("Share-token wajib.");
        if (!validCoord(Number(lat), Number(lng))) throw new Error("Koordinat tidak valid.");

        const data = store.read();
        const entry = Object.values(data.members).find(m => m.token === t);
        if (!entry) throw new Error("Token tidak dikenal atau sudah dicabut.");

        entry.location = { lat: Number(lat), lng: Number(lng), accuracy, battery };
        entry.updatedAt = new Date().toISOString();
        store.write({ members: { ...data.members, [entry.id]: entry } });
        return publicView(entry);
    }

    /** Daftar anggota + lokasi terakhir (tanpa token). */
    list() {
        const data = store.read();
        return { members: Object.values(data.members).map(publicView) };
    }

    /** Cabut berbagi lokasi seorang anggota (token mati). */
    revoke(id) {
        const data = store.read();
        if (!data.members[id]) throw new Error("Anggota tidak ditemukan.");
        const members = { ...data.members };
        delete members[id];
        store.write({ members });
        return { revoked: id };
    }

}

module.exports = new FamilyLocationService();
module.exports.validCoord = validCoord;   // untuk uji
