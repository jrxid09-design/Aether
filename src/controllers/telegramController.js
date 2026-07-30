const response = require("../utils/response");

const telegram = require("../services/telegramService");

class TelegramController {

    status(req, res, next) {

        try {
            return response.success(res, "Telegram status", telegram.status());
        }
        catch (error) {
            next(error);
        }

    }

    /** Simpan token/allowlist dari Settings lalu start ulang bot. */
    async saveConfig(req, res, next) {

        try {

            const { token, allowed } = req.body ?? {};

            const status = await telegram.reconfigure({ token, allowed });

            return response.success(res, "Telegram dikonfigurasi", status);

        }
        catch (error) {
            return response.error(res, error.message, 400);
        }

    }

    /** Kirim pesan uji ke chat yang diizinkan. */
    async test(req, res, next) {

        try {

            if (!telegram.status().running) {
                return response.error(res, "Bot Telegram tidak aktif.", 400);
            }

            const count = await telegram.broadcast(
                req.body?.text ?? "Uji dari Aether Console ✅"
            );

            return response.success(res, "Terkirim", { recipients: count });

        }
        catch (error) {
            return response.error(res, error.message, 400);
        }

    }

}

module.exports = new TelegramController();
