require("./events/listeners/loggerListener");

const app = require("./app");
const config = require("./config/env");
const logger = require("./utils/logger");

const startup = require("./bootstrap/startup");

const telemetry = require("./services/telemetryService");
const aiRuntime = require("./services/aiRuntimeService");
const memory = require("./memory/services/MemoryService");
const { manager: integrations } = require("./integrations");

const host = process.env.HOST ?? "0.0.0.0";

const server = app.listen(config.port, host, () => {

    startup(config);

    telemetry.info("SQLite connected");
    logger.info("SQLite connected");

    // Bidang kendali harus bisa melapor bahkan bila AI, memori,
    // atau integrasi gagal disiapkan, jadi kegagalan di sini
    // dicatat dan tidak menghentikan server.
    memory.start().catch(error => {
        telemetry.error(`Memori gagal disiapkan: ${error.message}`);
        logger.error(`Memori gagal disiapkan: ${error.message}`);
    });

    try {
        aiRuntime.initialize();
    }
    catch (error) {
        telemetry.error(`AI runtime gagal disiapkan: ${error.message}`);
        logger.error(`AI runtime gagal disiapkan: ${error.message}`);
    }

    integrations.load().startPolling();

    integrations.on("integration:changed", snapshot => {
        telemetry.publish("integration:changed", snapshot);
    });

    if (!process.env.AETHER_TOKEN) {

        telemetry.warn(
            "AETHER_TOKEN belum diset — bidang kendali terbuka untuk siapa pun di jaringan ini."
        );

    }

    logger.info(`Server listening on http://localhost:${config.port}`);
    logger.info(`Console API  : http://localhost:${config.port}/api/v1/console/overview`);

});

const shutdown = (signal) => {

    logger.info(`${signal} diterima, menghentikan Aether...`);

    integrations.stopPolling();

    memory.stop();

    server.close(() => process.exit(0));

    // Jangan menggantung selamanya kalau ada koneksi SSE yang
    // belum tertutup.
    setTimeout(() => process.exit(0), 5000).unref();

};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = server;
