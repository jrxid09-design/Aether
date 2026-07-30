const path = require("node:path");

const telemetry = require("./telemetryService");
const JsonStore = require("../core/config/JsonStore");

/**
 * Layanan suara sisi-daemon: STT (suara masuk) dan TTS neural
 * (suara keluar berkualitas).
 *
 * Keduanya memakai backend kompatibel-OpenAI yang bisa diatur dari
 * Settings (seperti skema API key):
 *   - STT  : /v1/audio/transcriptions (faster-whisper-server, dll)
 *   - TTS  : /v1/audio/speech (Kokoro-FastAPI, OpenAI, dll) —
 *            memberi banyak suara & dukungan bahasa Indonesia.
 *
 * Semua opsional & degradasinya anggun: tanpa STT, mic melapor
 * belum siap; tanpa TTS neural, Console jatuh ke suara OS
 * (speechSynthesis). Rahasia disimpan di configs/voice.json
 * (gitignored) dan dimasking saat ditampilkan.
 */
const store = new JsonStore(
    path.join(__dirname, "..", "..", "configs", "voice.json"),
    { stt: {}, tts: {} }
);

class VoiceService {

    constructor() {

        this.lastError = null;

    }

    // Setelan tersimpan menang atas .env.
    cfg() {
        return store.read();
    }

    get sttUrl() {
        return this.cfg().stt?.url || process.env.AETHER_STT_URL || null;
    }
    get sttModel() {
        return this.cfg().stt?.model || process.env.AETHER_STT_MODEL || "Systran/faster-whisper-base";
    }
    get sttKey() {
        return this.cfg().stt?.key || process.env.AETHER_STT_KEY || null;
    }
    get sttConfigured() {
        return Boolean(this.sttUrl);
    }

    get ttsUrl() {
        return this.cfg().tts?.url || process.env.AETHER_TTS_URL || null;
    }
    get ttsModel() {
        return this.cfg().tts?.model || process.env.AETHER_TTS_MODEL || "kokoro";
    }
    get ttsVoice() {
        return this.cfg().tts?.voice || process.env.AETHER_TTS_VOICE || "af_heart";
    }
    get ttsKey() {
        return this.cfg().tts?.key || process.env.AETHER_TTS_KEY || null;
    }
    get ttsConfigured() {
        return Boolean(this.ttsUrl);
    }

    /** Simpan setelan dari Settings (key dibiarkan bila tak dikirim). */
    setConfig({ stt, tts } = {}) {

        const current = this.cfg();

        const merge = (base, patch) => {
            if (!patch) return base;
            return {
                url: patch.url !== undefined ? (patch.url || null) : base.url ?? null,
                model: patch.model !== undefined ? (patch.model || null) : base.model ?? null,
                voice: patch.voice !== undefined ? (patch.voice || null) : base.voice ?? null,
                // key undefined = jangan ubah; "" = hapus.
                key: patch.key === undefined ? (base.key ?? null) : (patch.key || null)
            };
        };

        store.write({
            stt: merge(current.stt ?? {}, stt),
            tts: merge(current.tts ?? {}, tts)
        });

        return this.configView();

    }

    mask(key) {
        if (!key) return null;
        const s = String(key);
        return s.length <= 8 ? "••••" : `${s.slice(0, 4)}…${s.slice(-4)}`;
    }

    /** Untuk Settings: key dimasking. */
    configView() {

        const c = this.cfg();

        return {
            stt: {
                url: c.stt?.url ?? "",
                model: c.stt?.model ?? "",
                hasKey: Boolean(c.stt?.key),
                keyHint: this.mask(c.stt?.key),
                configured: this.sttConfigured
            },
            tts: {
                url: c.tts?.url ?? "",
                model: c.tts?.model ?? "",
                voice: c.tts?.voice ?? "",
                hasKey: Boolean(c.tts?.key),
                keyHint: this.mask(c.tts?.key),
                configured: this.ttsConfigured
            }
        };

    }

    status() {

        return {
            stt: {
                configured: this.sttConfigured,
                url: this.sttUrl,
                model: this.sttModel,
                lastError: this.lastError
            },
            tts: {
                // Neural bila dikonfigurasi; kalau tidak, renderer
                // memakai suara OS (speechSynthesis).
                neural: this.ttsConfigured,
                url: this.ttsUrl,
                model: this.ttsModel,
                voice: this.ttsVoice,
                engine: this.ttsConfigured ? "neural (OpenAI-compatible)" : "speechSynthesis (OS)"
            }
        };

    }

    /**
     * Hasilkan audio ucapan dari teks lewat backend TTS neural.
     * @returns {Promise<{ audio: Buffer, contentType: string }>}
     */
    async speak(text, { voice = null, format = "mp3" } = {}) {

        if (!this.ttsConfigured) {
            const error = new Error(
                "TTS neural belum dikonfigurasi. Set endpoint /v1/audio/speech " +
                "(mis. Kokoro-FastAPI) di Settings, atau pakai suara OS."
            );
            error.code = "TTS_NOT_CONFIGURED";
            throw error;
        }

        const headers = { "Content-Type": "application/json" };
        if (this.ttsKey) {
            headers.Authorization = `Bearer ${this.ttsKey}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);

        try {

            const response = await fetch(this.ttsUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: this.ttsModel,
                    input: text,
                    voice: voice || this.ttsVoice,
                    response_format: format
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => "");
                throw new Error(`Backend TTS menolak (${response.status}): ${detail.slice(0, 200)}`);
            }

            const audio = Buffer.from(await response.arrayBuffer());

            telemetry.publish("voice:spoken", { chars: text.length, voice: voice || this.ttsVoice });

            return {
                audio,
                contentType: response.headers.get("content-type") || `audio/${format}`
            };

        }

        catch (error) {
            if (error.name === "AbortError") {
                throw new Error("TTS melebihi batas waktu.");
            }
            if (error instanceof TypeError) {
                throw new Error(`Tidak bisa menghubungi backend TTS di ${this.ttsUrl}`);
            }
            throw error;
        }

        finally {
            clearTimeout(timer);
        }

    }

    /**
     * Transkripsi audio menjadi teks.
     *
     * @param {Buffer} audio  data audio mentah (webm/ogg/wav)
     * @param {object} opts
     * @param {string} opts.mimeType
     * @param {string} [opts.language]  kode ISO, mis. "id"
     * @returns {Promise<{ text: string }>}
     */
    async transcribe(audio, { mimeType = "audio/webm", language = "id" } = {}) {

        if (!this.sttConfigured) {

            const error = new Error(
                "STT belum dikonfigurasi. Set AETHER_STT_URL ke endpoint transcribe " +
                "kompatibel-OpenAI (mis. faster-whisper-server) di mesin daemon."
            );

            error.code = "STT_NOT_CONFIGURED";

            throw error;

        }

        if (!audio || audio.length === 0) {
            throw new Error("Audio kosong.");
        }

        const extension = extensionFor(mimeType);

        const form = new FormData();

        form.append(
            "file",
            new Blob([audio], { type: mimeType }),
            `speech.${extension}`
        );

        form.append("model", this.sttModel);

        if (language) {
            form.append("language", language);
        }

        // Format teks polos paling sederhana untuk diparse.
        form.append("response_format", "json");

        const headers = {};

        if (this.sttKey) {
            headers.Authorization = `Bearer ${this.sttKey}`;
        }

        const controller = new AbortController();

        const timer = setTimeout(() => controller.abort(), 60000);

        try {

            const response = await fetch(this.sttUrl, {
                method: "POST",
                headers,
                body: form,
                signal: controller.signal
            });

            if (!response.ok) {

                const detail = await response.text().catch(() => "");

                throw new Error(
                    `Backend STT menolak (${response.status}): ${detail.slice(0, 200)}`
                );

            }

            const data = await response.json().catch(() => null);

            const text = (data?.text ?? "").trim();

            this.lastError = null;

            telemetry.publish("voice:transcribed", {
                chars: text.length,
                language
            });

            return { text };

        }

        catch (error) {

            this.lastError =
                error.name === "AbortError"
                    ? "transcribe melebihi batas waktu"
                    : error.message;

            if (error.name === "AbortError") {
                throw new Error("Transkripsi melebihi batas waktu.");
            }

            if (error instanceof TypeError) {
                throw new Error(`Tidak bisa menghubungi backend STT di ${this.sttUrl}`);
            }

            throw error;

        }

        finally {
            clearTimeout(timer);
        }

    }

}

function extensionFor(mimeType) {

    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";

    return "webm";

}

module.exports = new VoiceService();
