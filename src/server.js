require("./events/listeners/loggerListener");

const app = require("./app");
const config = require("./config/env");
const logger = require("./utils/logger");

const startup = require("./bootstrap/startup");

const telemetry = require("./services/telemetryService");
const aiRuntime = require("./services/aiRuntimeService");
const memory = require("./memory/services/MemoryService");
const whatsapp = require("./services/whatsappService");
const automation = require("./services/automationService");
const terminals = require("./runtime/terminal/TerminalRuntime");
const { manager: integrations } = require("./integrations");

const host = process.env.HOST ?? "0.0.0.0";

let server = null;
let shuttingDown = false;

/**
 * Menyiapkan subsistem SETELAH server berhasil listen.
 *
 * Semua di sini dibungkus try/catch masing-masing: kegagalan AI,
 * memori, atau integrasi tidak boleh menjatuhkan daemon —
 * bidang kendali tetap harus hidup untuk melapor apa yang rusak.
 */
function bootSubsystems() {

    startup(config);

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

    try {
        integrations.load().startPolling();

        integrations.on("integration:changed", snapshot => {
            telemetry.publish("integration:changed", snapshot);
        });
    }
    catch (error) {
        telemetry.error(`Integrasi gagal disiapkan: ${error.message}`);
        logger.error(`Integrasi gagal disiapkan: ${error.message}`);
    }

    // WhatsApp (nonaktif diam-diam bila belum tertaut / paket belum diinstall).
    whatsapp.start().catch(error => {
        telemetry.error(`WhatsApp gagal disiapkan: ${error.message}`);
    });

    // Lapisan proaktif: brief harian terjadwal (aktif bila diset di Settings).
    automation.start();

    // Terminal Runtime (pty persisten; nonaktif diam-diam bila node-pty belum ada).
    terminals.start();

    // Auto-nyalakan runtime inti (Hermes/OpenClaw/Ollama) agar dashboard tak
    // "DEGRADED" tiap Aether dibuka. Ditunda agar terminal & health siap;
    // melewati yang sudah online. Bisa dimatikan di configs/runtimes.json.
    setTimeout(() => {
        try {
            require("./runtime/runtimeService").autostart()
                .catch(error => logger.warn?.(`Autostart runtime: ${error.message}`));
        }
        catch (error) { logger.warn?.(`Autostart runtime: ${error.message}`); }
    }, 4000).unref?.();

    // Gateway WebSocket khusus I/O terminal, menempel pada server HTTP yg sama.
    try {
        require("./ws/terminalGateway").attach(server);
    }
    catch (error) {
        logger.error(`Terminal gateway gagal: ${error.message}`);
    }

    if (!process.env.AETHER_TOKEN) {
        telemetry.warn(
            "AETHER_TOKEN belum diset — bidang kendali terbuka untuk siapa pun di jaringan ini."
        );
    }

    logger.info(`Server listening on http://localhost:${config.port}`);
    logger.info(`Console API  : http://localhost:${config.port}/api/v1/console/overview`);

    // Banner ringkas & berwarna (senada CLI) supaya `npm start` mudah dibaca.
    try {
        const { c, symbols, hr } = require("./cli/theme");
        const base = `http://localhost:${config.port}`;
        const tokenLine = process.env.AETHER_TOKEN
            ? c.ok("aktif") : c.warn("terbuka — set AETHER_TOKEN untuk mengunci");
        console.log("\n" + hr("Aether siap"));
        console.log(`  ${symbols.aether} Daemon       ${c.accent(base)}`);
        console.log(`  ${symbols.aether} Console API  ${c.muted(base + "/api/v1/console/overview")}`);
        console.log(`  ${symbols.aether} CLI          ${c.muted("npm run cli")}`);
        console.log(`  ${symbols.dot} Token        ${tokenLine}`);
        console.log(hr() + "\n");
    }
    catch { /* banner opsional */ }

}

/**
 * Jalankan daemon.
 *
 * Kegagalan listen (paling sering EADDRINUSE karena daemon lain
 * masih hidup) DULUNYA membuat proses mati dengan stack trace
 * tanpa penjelasan — inilah sumber utama "kadang jalan kadang
 * tidak". Sekarang error itu ditangkap dan dijelaskan.
 */
function listen(port, attemptsLeft = autoPortAttempts()) {

    server = app.listen(port, host);

    server.on("listening", () => {
        // Jika port digeser otomatis, pakai port final di seluruh app.
        config.port = server.address().port;
        bootSubsystems();
    });

    server.on("error", error => {

        if (error.code === "EADDRINUSE") {

            // Port dipakai proses lain. Sering kali itu justru daemon
            // Aether yang SUDAH jalan — bukan kesalahan fatal.
            if (attemptsLeft > 0) {

                const next = port + 1;

                logger.warn(
                    `Port ${port} sedang dipakai — mencoba ${next}...`
                );

                setTimeout(() => listen(next, attemptsLeft - 1), 150);

                return;

            }

            logger.error(
                `Port ${port} sedang dipakai dan tidak ada port pengganti.`
            );
            logger.error(
                "Kemungkinan Aether sudah berjalan. Pilihan:"
            );
            logger.error(
                `  • Sambungkan Console ke daemon yang sudah ada (http://localhost:${port}).`
            );
            logger.error(
                "  • Atau hentikan proses lama, lalu jalankan ulang."
            );
            logger.error(
                "    Windows : Get-Process node | Stop-Process -Force"
            );
            logger.error(
                "    Linux   : pkill -f 'node src/server.js'"
            );
            logger.error(
                "  • Atau pakai port lain: set PORT=3001 lalu jalankan lagi."
            );

            process.exit(1);

        }

        if (error.code === "EACCES") {

            logger.error(
                `Tidak diizinkan membuka port ${port}. Coba port di atas 1024.`
            );

            process.exit(1);

        }

        logger.error(`Gagal menjalankan server: ${error.message}`);

        process.exit(1);

    });

}

/**
 * Berapa kali menggeser port bila bentrok.
 *
 * Default 0 — lebih baik gagal dengan pesan jelas daripada diam-
 * diam pindah port dan bikin Console kehilangan daemon. Aktifkan
 * geser-otomatis hanya bila diminta lewat AETHER_PORT_AUTO.
 */
function autoPortAttempts() {

    return process.env.AETHER_PORT_AUTO === "1" ? 10 : 0;

}

const shutdown = (signal) => {

    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    logger.info(`${signal} diterima, menghentikan Aether...`);

    integrations.stopPolling();
    memory.stop();
    whatsapp.stop();
    automation.stop();
    terminals.stop();

    if (server) {
        server.close(() => process.exit(0));
    }
    else {
        process.exit(0);
    }

    // Jangan menggantung selamanya kalau ada koneksi SSE yang
    // belum tertutup.
    setTimeout(() => process.exit(0), 5000).unref();

};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Sebuah promise yang gagal tanpa .catch DULUNYA bisa menjatuhkan
// proses di versi Node baru. Untuk daemon, lebih baik dicatat dan
// tetap hidup daripada mati mendadak di tengah malam.
process.on("unhandledRejection", (reason) => {
    const message = reason?.stack ?? reason?.message ?? String(reason);
    logger.error(`Unhandled rejection: ${message}`);
    telemetry.error(`Unhandled rejection: ${reason?.message ?? reason}`);
});

// Exception tak tertangkap menandakan state mungkin sudah rusak.
// Dicatat lengkap lalu keluar tertib supaya manajer proses
// (pm2/systemd/Console) bisa menyalakan ulang dengan bersih.
process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error.stack ?? error.message}`);
    telemetry.error(`Uncaught exception: ${error.message}`);
    shutdown("uncaughtException");
});

listen(Number(config.port) || 3000);

module.exports = { app };
