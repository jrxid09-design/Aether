const { AITool } = require("../ai/tools");

const home = require("./homeService");

/**
 * Tool kendali rumah untuk Aether. Dengan ini Aether bisa
 * "nyalakan lampu ruang tamu", "matikan AC", "set kamar 24 derajat"
 * lewat percakapan — lewat Home Assistant.
 */
function homeTools() {

    return [

        new AITool({

            name: "home_devices",

            description:
                "Lihat daftar perangkat rumah (lampu, saklar, AC, kipas, dll) beserta " +
                "status dan entity_id-nya lewat Home Assistant. Pakai untuk menemukan " +
                "entity_id yang tepat sebelum mengendalikan, atau saat pengguna bertanya " +
                "'perangkat apa saja yang ada / mana yang menyala'.",

            parameters: {
                type: "object",
                properties: {
                    domain: {
                        type: "string",
                        description: "Saring per jenis, mis. 'light', 'switch', 'climate', 'fan'. Kosong = semua."
                    }
                }
            },

            execute: async ({ domain }) => {

                const entities = await home.listEntities({ domain: domain || null });

                return {
                    count: entities.length,
                    devices: entities.slice(0, 80).map(e => ({
                        entity_id: e.id,
                        name: e.name,
                        domain: e.domain,
                        state: e.state
                    }))
                };

            }

        }),

        new AITool({

            name: "home_control",

            description:
                "Kendalikan perangkat rumah lewat Home Assistant. action: 'on'/'off'/" +
                "'toggle' untuk lampu/saklar/kipas; 'brightness' (0-100) untuk lampu; " +
                "'temperature' (derajat) untuk AC/climate. Butuh entity_id — cari lewat " +
                "home_devices dulu bila belum tahu.",

            parameters: {
                type: "object",
                properties: {
                    entity_id: { type: "string", description: "mis. light.ruang_tamu" },
                    action: {
                        type: "string",
                        enum: ["on", "off", "toggle", "brightness", "temperature"]
                    },
                    value: {
                        type: "number",
                        description: "Untuk brightness (0-100) atau temperature (derajat)."
                    }
                },
                required: ["entity_id", "action"]
            },

            execute: async ({ entity_id, action, value }) => {

                await home.control(entity_id, action, value);

                // Kembalikan state terbaru sebagai konfirmasi.
                const state = await home.getState(entity_id).catch(() => null);

                return {
                    ok: true,
                    entity_id,
                    action,
                    state: state?.state ?? null
                };

            }

        }),

        new AITool({

            name: "home_state",

            description:
                "Cek status satu perangkat rumah (nyala/mati, suhu, kecerahan, dll) " +
                "berdasarkan entity_id.",

            parameters: {
                type: "object",
                properties: {
                    entity_id: { type: "string", description: "mis. climate.kamar" }
                },
                required: ["entity_id"]
            },

            execute: async ({ entity_id }) => {

                const state = await home.getState(entity_id);

                if (!state) {
                    return { found: false };
                }

                return {
                    found: true,
                    entity_id: state.id,
                    state: state.state,
                    attributes: state.attributes
                };

            }

        })

    ];

}

module.exports = { homeTools };
