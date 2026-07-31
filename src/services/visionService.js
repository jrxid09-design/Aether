const path = require("node:path");

const telemetry = require("./telemetryService");
const JsonStore = require("../core/config/JsonStore");

/**
 * Vision — Aether "melihat" gambar (frame kamera/CCTV, foto).
 *
 * Memakai engine AI yang sama; hanya bentuk pesannya yang beda
 * karena multimodal:
 *   - Ollama: pesan { content, images:[base64] }  (mis. llava, qwen2-vl)
 *   - OpenAI-compatible: content array [{type:text},{type:image_url}]
 *
 * Model vision dipilih terpisah dari model chat (chat model belum
 * tentu bisa melihat). Diatur di Settings; tanpa model vision,
 * fitur melapor belum siap dengan anggun.
 */
const store = new JsonStore(
    path.join(__dirname, "..", "..", "configs", "vision.json"),
    { model: null }
);

class VisionService {

    cfg() {
        return store.read();
    }

    /** Model vision aktif. Default masuk akal per jenis provider. */
    model() {

        const configured = this.cfg().model || process.env.AETHER_VISION_MODEL;

        if (configured) {
            return configured;
        }

        const aiRuntime = require("./aiRuntimeService");
        const kind = aiRuntime.activePlatform?.kind;

        // Default aman: llava untuk Ollama lokal; kalau cloud,
        // biarkan null agar pengguna memilih (nama model bervariasi).
        return kind === "ollama" ? "llava" : null;

    }

    get configured() {
        return Boolean(this.model());
    }

    setConfig({ model } = {}) {
        store.write({ model: model !== undefined ? (model || null) : this.cfg().model });
        return this.configView();
    }

    configView() {
        return {
            model: this.cfg().model ?? "",
            effective: this.model(),
            configured: this.configured
        };
    }

    /**
     * Analisis satu gambar.
     * @param {object} opts
     * @param {string} opts.imageBase64  base64 tanpa prefix data:
     * @param {string} [opts.mimeType]
     * @param {string} [opts.prompt]
     * @returns {Promise<{ text:string, model:string }>}
     */
    async analyze({ imageBase64, mimeType = "image/jpeg", prompt } = {}) {

        if (!imageBase64) {
            throw new Error("Gambar kosong.");
        }

        const model = this.model();

        if (!model) {
            const error = new Error(
                "Model vision belum diatur. Pilih model vision (mis. llava di Ollama, " +
                "atau model vision cloud) di Settings → Vision."
            );
            error.code = "VISION_NOT_CONFIGURED";
            throw error;
        }

        const aiRuntime = require("./aiRuntimeService");
        const kind = aiRuntime.activePlatform?.kind ?? "ollama";

        const question = prompt ||
            "Deskripsikan isi gambar ini secara ringkas dalam bahasa Indonesia: " +
            "ada siapa/apa, aktivitas, dan hal yang menonjol.";

        const message = kind === "ollama"
            ? {
                role: "user",
                content: question,
                images: [imageBase64]
            }
            : {
                role: "user",
                content: [
                    { type: "text", text: question },
                    {
                        type: "image_url",
                        image_url: { url: `data:${mimeType};base64,${imageBase64}` }
                    }
                ]
            };

        const response = await aiRuntime.ensure().chat({
            messages: [message],
            model
        });

        telemetry.publish("vision:analyzed", {
            model,
            chars: (response.content ?? "").length
        });

        return { text: response.content ?? "", model };

    }

    /** Ambil gambar dari URL (snapshot CCTV/kamera) lalu analisis. */
    async analyzeUrl({ url, prompt, headers = {} } = {}) {

        if (!url) {
            throw new Error("URL kamera kosong.");
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        let imageBase64;
        let mimeType;

        try {
            const response = await fetch(url, { headers, signal: controller.signal });

            if (!response.ok) {
                throw new Error(`Snapshot gagal (${response.status})`);
            }

            mimeType = response.headers.get("content-type") || "image/jpeg";
            imageBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
        }
        catch (error) {
            if (error.name === "AbortError") {
                throw new Error("Snapshot kamera timeout.");
            }
            if (error instanceof TypeError) {
                throw new Error(`Tidak bisa mengambil snapshot dari ${url}`);
            }
            throw error;
        }
        finally {
            clearTimeout(timer);
        }

        return this.analyze({ imageBase64, mimeType, prompt });

    }

    status() {
        return {
            configured: this.configured,
            model: this.model()
        };
    }

}

module.exports = new VisionService();
