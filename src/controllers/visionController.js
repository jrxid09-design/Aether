const response = require("../utils/response");

const vision = require("../services/visionService");
const deviceService = require("../services/deviceService");

function fail(res, error) {
    const code = error.code === "VISION_NOT_CONFIGURED" ? 400 : 502;
    return response.error(res, error.message, code);
}

class VisionController {

    status(req, res, next) {
        try {
            return response.success(res, "Vision status", vision.status());
        }
        catch (error) {
            next(error);
        }
    }

    config(req, res, next) {
        try {
            return response.success(res, "Vision config", vision.configView());
        }
        catch (error) {
            next(error);
        }
    }

    saveConfig(req, res, next) {
        try {
            return response.success(res, "Konfigurasi vision disimpan",
                vision.setConfig(req.body ?? {}));
        }
        catch (error) {
            return response.error(res, error.message, 400);
        }
    }

    /** Analisis gambar yang dikirim renderer (base64) — mis. frame webcam. */
    async analyze(req, res, next) {

        try {

            const { image, mimeType, prompt } = req.body ?? {};

            if (!image) {
                return response.error(res, "Field 'image' (base64) wajib diisi.", 400);
            }

            const result = await vision.analyze({
                imageBase64: image,
                mimeType: mimeType ?? "image/jpeg",
                prompt
            });

            return response.success(res, "Analisis selesai", result);

        }
        catch (error) {
            return fail(res, error);
        }

    }

    // ---- Kamera --------------------------------------------------

    cameras(req, res, next) {
        try {
            return response.success(res, "Cameras", { cameras: deviceService.cameras() });
        }
        catch (error) {
            next(error);
        }
    }

    addCamera(req, res, next) {
        try {
            return response.success(res, "Kamera ditambahkan",
                deviceService.addCamera(req.body ?? {}), 201);
        }
        catch (error) {
            return response.error(res, error.message, 400);
        }
    }

    removeCamera(req, res, next) {
        try {
            return response.success(res, "Kamera dihapus", {
                removed: deviceService.removeCamera(req.params.id)
            });
        }
        catch (error) {
            next(error);
        }
    }

    /**
     * Proxy snapshot kamera: daemon yang mengambil gambar (dengan
     * header/auth kamera) lalu meneruskan byte-nya ke renderer.
     * Dipakai untuk pratinjau "live" — renderer me-refresh <img> ini
     * berkala, jadi tak perlu akses langsung ke kamera (hindari CORS).
     */
    async snapshot(req, res, next) {

        try {

            const cam = deviceService.getCamera(req.params.id);

            if (!cam) {
                return response.error(res, "Kamera tidak ditemukan.", 404);
            }

            const upstream = await fetch(cam.snapshotUrl, {
                headers: cam.headers ?? {},
                signal: AbortSignal.timeout(8000)
            });

            if (!upstream.ok) {
                return response.error(res, `Kamera balas ${upstream.status}`, 502);
            }

            const buffer = Buffer.from(await upstream.arrayBuffer());

            res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
            res.setHeader("Cache-Control", "no-store");

            return res.end(buffer);

        }
        catch (error) {
            return response.error(res, `Snapshot gagal: ${error.message}`, 502);
        }

    }

    /** Ambil snapshot kamera lalu analisis dengan model vision. */
    async seeCamera(req, res, next) {

        try {

            const cam = deviceService.getCamera(req.params.id);

            if (!cam) {
                return response.error(res, "Kamera tidak ditemukan.", 404);
            }

            const result = await vision.analyzeUrl({
                url: cam.snapshotUrl,
                headers: cam.headers ?? {},
                prompt: req.body?.prompt
            });

            return response.success(res, "Analisis kamera selesai", {
                camera: cam.id,
                ...result
            });

        }
        catch (error) {
            return fail(res, error);
        }

    }

}

module.exports = new VisionController();
