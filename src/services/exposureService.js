const path = require("node:path");
const JsonStore = require("../core/config/JsonStore");
const telemetry = require("./telemetryService");

/**
 * exposureService — Cek Paparan Data (defensif, berbasis persetujuan).
 *
 * Mengecek apakah email/username MILIK PENGGUNA atau akun keluarga (yang
 * izinnya dipegang pengguna) muncul di kebocoran data publik, via API
 * resmi Have I Been Pwned (v3). HIBP tidak mengembalikan kata sandi atau
 * data pihak ketiga — hanya "akun ini pernah ada di kebocoran X" — jadi
 * ini alat keamanan diri, bukan doxing.
 *
 * Butuh API key HIBP (berbayar, milik pengguna) yang disimpan di
 * configs/exposure.json (gitignored, ditutup sebagian saat ditampilkan).
 */

const FILE = process.env.AETHER_EXPOSURE_FILE
    || path.join(__dirname, "..", "..", "configs", "exposure.json");

const store = new JsonStore(FILE, { apiKey: null });
const HIBP = "https://haveibeenpwned.com/api/v3";

function mask(key) {
    if (!key) return null;
    return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/** Saran remediasi dari kelas data yang bocor (pure). */
function advise(dataClasses = []) {
    const d = dataClasses.map(x => String(x).toLowerCase());
    const tips = [];
    if (d.some(x => x.includes("password")))
        tips.push("Segera ganti kata sandi akun ini dan semua akun yang memakai kata sandi sama; aktifkan 2FA.");
    if (d.some(x => x.includes("credit") || x.includes("bank")))
        tips.push("Pantau transaksi kartu/rekening; pertimbangkan blokir atau ganti kartu.");
    if (d.some(x => x.includes("phone") || x.includes("address")))
        tips.push("Waspadai penipuan yang memakai nomor/alamatmu; jangan bagikan OTP.");
    if (!tips.length)
        tips.push("Waspadai phishing yang mengatasnamakan layanan ini.");
    return tips;
}

class ExposureService {

    status() {
        const cfg = store.read();
        return { configured: Boolean(cfg.apiKey), apiKey: mask(cfg.apiKey) };
    }

    configure({ apiKey } = {}) {
        store.write({ apiKey: apiKey || null });
        return this.status();
    }

    /**
     * Cek satu akun (email/username) di kebocoran data.
     * @returns {breached, count, breaches[], advice[]}
     */
    async check(account) {
        const acct = String(account || "").trim();
        if (!acct) throw new Error("Sertakan email atau username yang ingin dicek.");

        const cfg = store.read();
        if (!cfg.apiKey) {
            throw new Error("API key Have I Been Pwned belum diatur (POST /exposure/config).");
        }

        const url = `${HIBP}/breachedaccount/${encodeURIComponent(acct)}?truncateResponse=false`;
        const res = await fetch(url, {
            headers: { "hibp-api-key": cfg.apiKey, "user-agent": "Aether-Exposure-Check" }
        });

        if (res.status === 404) {
            return { account: acct, breached: false, count: 0, breaches: [], advice: ["Aman — tak ditemukan di kebocoran yang diketahui. Tetap pakai kata sandi unik + 2FA."] };
        }
        if (res.status === 401) throw new Error("API key HIBP ditolak (401). Periksa kembali key.");
        if (res.status === 429) throw new Error("Terlalu sering meminta ke HIBP (429). Coba lagi sebentar.");
        if (!res.ok) throw new Error(`HIBP error ${res.status}.`);

        const raw = await res.json();
        const breaches = (Array.isArray(raw) ? raw : []).map(b => ({
            name: b.Name, title: b.Title, domain: b.Domain,
            breachDate: b.BreachDate, dataClasses: b.DataClasses || []
        }));

        const allClasses = [...new Set(breaches.flatMap(b => b.dataClasses))];
        telemetry.info(`[exposure] cek '${acct}': ${breaches.length} kebocoran`);
        return { account: acct, breached: breaches.length > 0, count: breaches.length, breaches, advice: advise(allClasses) };
    }

}

module.exports = new ExposureService();
module.exports.advise = advise;   // untuk uji
