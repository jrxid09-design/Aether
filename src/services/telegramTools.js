const { AITool } = require("../ai/tools");

const telegram = require("./telegramService");

/**
 * Tool agar Aether bisa mengirim media saat sedang mengobrol di
 * Telegram — stiker, gambar, atau berkas. Tujuannya adalah chat
 * yang sedang dilayani (telegram.currentChatId).
 */
function telegramTools() {

    const ensureChat = () => {
        if (!telegram.running || !telegram.currentChatId) {
            throw new Error("Tool ini hanya bisa dipakai saat sedang mengobrol via Telegram.");
        }
        return telegram.currentChatId;
    };

    return [

        new AITool({
            name: "telegram_send_photo",
            description:
                "Kirim gambar ke percakapan Telegram yang sedang berlangsung. Pakai saat " +
                "pengguna minta dikirimi gambar/foto (mis. snapshot CCTV, ilustrasi via URL).",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL gambar (http/https)." },
                    caption: { type: "string", description: "Keterangan (opsional)." }
                },
                required: ["url"]
            },
            execute: async ({ url, caption }) => {
                await telegram.sendPhoto(ensureChat(), url, caption);
                return { sent: true };
            }
        }),

        new AITool({
            name: "telegram_send_document",
            description:
                "Kirim berkas/dokumen ke percakapan Telegram yang sedang berlangsung " +
                "(via URL).",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL berkas." },
                    caption: { type: "string", description: "Keterangan (opsional)." }
                },
                required: ["url"]
            },
            execute: async ({ url, caption }) => {
                await telegram.sendDocument(ensureChat(), url, caption);
                return { sent: true };
            }
        }),

        new AITool({
            name: "telegram_send_sticker",
            description:
                "Kirim stiker ke percakapan Telegram yang sedang berlangsung, untuk " +
                "menambah ekspresi. Butuh file_id stiker atau URL .webp/.tgs.",
            parameters: {
                type: "object",
                properties: {
                    sticker: { type: "string", description: "file_id stiker atau URL .webp/.tgs." }
                },
                required: ["sticker"]
            },
            execute: async ({ sticker }) => {
                await telegram.sendSticker(ensureChat(), sticker);
                return { sent: true };
            }
        })

    ];

}

module.exports = { telegramTools };
