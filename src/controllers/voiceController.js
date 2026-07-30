const response = require("../utils/response");

const voiceService = require("../services/voiceService");

class VoiceController {

    status(req, res, next) {

        try {
            return response.success(res, "Voice status", voiceService.status());
        }
        catch (error) {
            next(error);
        }

    }

    /**
     * Terima audio (base64) dari renderer, kembalikan teks.
     *
     * Base64 dipilih ketimbang multipart karena renderer sudah
     * memegang Blob rekaman dan JSON lebih mudah lewat lapisan
     * fetch yang sama dengan endpoint lain.
     */
    async transcribe(req, res, next) {

        try {

            const { audio, mimeType, language } = req.body ?? {};

            if (!audio) {
                return response.error(res, "Field 'audio' (base64) wajib diisi.", 400);
            }

            const buffer = Buffer.from(audio, "base64");

            const result = await voiceService.transcribe(buffer, {
                mimeType: mimeType ?? "audio/webm",
                language: language ?? "id"
            });

            return response.success(res, "Transkripsi selesai", result);

        }

        catch (error) {

            // Belum dikonfigurasi bukan error server — beri 400 dengan
            // pesan yang bisa ditindaklanjuti Console.
            if (error.code === "STT_NOT_CONFIGURED") {
                return response.error(res, error.message, 400);
            }

            return response.error(res, error.message, 502);

        }

    }

}

module.exports = new VoiceController();
