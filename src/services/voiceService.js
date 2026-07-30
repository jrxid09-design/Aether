const telemetry = require("./telemetryService");

/**
 * Layanan suara sisi-daemon.
 *
 * Suara KELUAR (TTS) terjadi di renderer Console lewat
 * speechSynthesis OS — tidak butuh daemon. Yang ditangani di sini
 * adalah suara MASUK (STT): renderer mengirim audio, daemon
 * meneruskannya ke mesin transcribe.
 *
 * Mengikuti pola seluruh Aether: backend-nya konfigurabel dan
 * degradasinya anggun. Tanpa STT terkonfigurasi, fitur suara-masuk
 * melapor "belum siap" dengan jelas — avatar dan TTS tetap jalan.
 *
 * Backend yang didukung: endpoint transcribe kompatibel-OpenAI
 * (faster-whisper-server, whisper.cpp server, LocalAI, dll) lewat
 * multipart /v1/audio/transcriptions.
 */
class VoiceService {

    constructor() {

        this.sttUrl = process.env.AETHER_STT_URL ?? null;

        this.sttModel =
            process.env.AETHER_STT_MODEL ?? "Systran/faster-whisper-base";

        this.sttKey = process.env.AETHER_STT_KEY ?? null;

        this.lastError = null;

    }

    get sttConfigured() {

        return Boolean(this.sttUrl);

    }

    status() {

        return {
            stt: {
                configured: this.sttConfigured,
                url: this.sttUrl,
                model: this.sttModel,
                lastError: this.lastError
            },
            // TTS diurus renderer (speechSynthesis), selalu tersedia
            // selama OS punya voice.
            tts: {
                engine: "speechSynthesis (renderer)",
                note: "Suara & bahasa dipilih di sisi Console."
            }
        };

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
