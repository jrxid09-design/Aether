const path = require("node:path");

const JsonStore = require("../core/config/JsonStore");
const telemetry = require("./telemetryService");

/**
 * Cache kesehatan model — dipelajari, bukan di-hardcode.
 *
 * Daftar /models tiap platform tak bisa dipercaya (model usang tetap
 * terdaftar tapi 404 saat dipakai). Alih-alih denylist statis, kita
 * BELAJAR dari kegagalan nyata: model yang 404/403/410 ditandai "bad",
 * yang lolos generateContent ditandai "verified". Berlaku 24 jam lalu
 * ditemukan ulang (model yang tadinya mati bisa pulih).
 *
 * Disimpan lokal di configs/model-health.json (per-mesin, gitignored).
 */

const TTL_MS = 24 * 60 * 60 * 1000;

const store = new JsonStore(
    path.join(__dirname, "..", "..", "configs", "model-health.json"),
    { models: {} }
);

const key = (platform, id) => `${platform}:${id}`;

class ModelHealthService {

    /** Entri jika masih segar (<24 jam), selain itu null (kadaluwarsa). */
    get(platform, id) {
        const entry = store.read().models[key(platform, id)];
        if (!entry) return null;
        if (Date.now() - entry.ts > TTL_MS) return null;
        return entry;
    }

    isBad(platform, id) {
        return this.get(platform, id)?.status === "bad";
    }

    /** status: verified | bad | quota */
    mark(platform, id, status, reason = null) {
        const models = { ...store.read().models };
        models[key(platform, id)] = { platform, id, status, reason, ts: Date.now() };
        store.write({ models });
        telemetry.publish("model:health", { platform, id, status, reason });
        return models[key(platform, id)];
    }

    /** Peta id→entri yang masih segar untuk satu platform. */
    all(platform) {
        const out = {};
        const now = Date.now();
        for (const entry of Object.values(store.read().models)) {
            if (entry.platform === platform && now - entry.ts <= TTL_MS) {
                out[entry.id] = entry;
            }
        }
        return out;
    }

}

module.exports = new ModelHealthService();
