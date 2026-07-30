const path = require("node:path");

const telemetry = require("./telemetryService");
const JsonStore = require("../core/config/JsonStore");

/** Setelan Telegram tersimpan (token via Settings, bukan hanya .env). */
const store = new JsonStore(
    path.join(__dirname, "..", "..", "configs", "telegram.json"),
    { token: null, allowed: [] }
);

/**
 * Jembatan Telegram — remote control Aether dari mana saja.
 *
 * Memakai long-polling (getUpdates), bukan webhook, supaya jalan
 * di belakang NAT rumah tanpa perlu port publik atau domain.
 *
 * Keamanan: hanya membalas chat id yang diizinkan
 * (AETHER_TELEGRAM_ALLOWED). Tanpa allowlist, bot hanya mau
 * memberi tahu chat id-mu (lewat /id) dan menolak yang lain —
 * supaya rumahmu tidak bisa dikendalikan orang asing yang
 * kebetulan menemukan bot.
 */
class TelegramService {

    constructor() {

        // Setelan tersimpan (Settings) menang atas .env, sehingga
        // token bisa diisi lewat aplikasi tanpa menyentuh berkas.
        const saved = store.read();

        this.token = saved.token ?? process.env.AETHER_TELEGRAM_TOKEN ?? null;

        this.allowed = saved.allowed?.length
            ? new Set(saved.allowed.map(String))
            : this.parseAllowed(process.env.AETHER_TELEGRAM_ALLOWED);

        this.api = this.token
            ? `https://api.telegram.org/bot${this.token}`
            : null;

        this.running = false;
        this.offset = 0;
        this.me = null;
        this.lastError = null;
        this.startedAt = null;

        /** Konteks percakapan ringkas per chat. */
        this.sessions = new Map();

        this.pollController = null;

    }

    parseAllowed(value) {

        return new Set(
            String(value ?? "")
                .split(",")
                .map(s => s.trim())
                .filter(Boolean)
        );

    }

    get configured() {
        return Boolean(this.token);
    }

    isAllowed(chatId) {

        // Tanpa allowlist, tak seorang pun otomatis diizinkan
        // (mode aman). Pengguna harus mendaftarkan id-nya dulu.
        if (this.allowed.size === 0) {
            return false;
        }

        return this.allowed.has(String(chatId));

    }

    async start() {

        if (!this.configured) {
            telemetry.info("[telegram] AETHER_TELEGRAM_TOKEN belum diset — bot nonaktif.");
            return this;
        }

        if (this.running) {
            return this;
        }

        // Validasi token dulu; token salah = jangan mulai polling.
        try {
            this.me = await this.call("getMe");
        }
        catch (error) {
            this.lastError = error.message;
            telemetry.error(`[telegram] token ditolak: ${error.message}`);
            return this;
        }

        this.running = true;
        this.startedAt = Date.now();

        telemetry.info(
            `[telegram] bot @${this.me.username} aktif` +
            (this.allowed.size === 0
                ? " — TANPA allowlist, kirim /id ke bot untuk daftarkan chat id-mu"
                : ` — ${this.allowed.size} chat diizinkan`)
        );

        this.loop();

        return this;

    }

    stop() {

        this.running = false;

        this.pollController?.abort();
        this.pollController = null;

        return this;

    }

    /**
     * Simpan token/allowlist dari Settings lalu start ulang bot
     * dengan setelan baru — tanpa merestart daemon.
     */
    async reconfigure({ token, allowed } = {}) {

        const current = store.read();

        const next = {
            token: token !== undefined ? (token || null) : current.token,
            allowed: allowed !== undefined
                ? this.parseAllowedList(allowed)
                : current.allowed
        };

        store.write(next);

        this.stop();

        this.token = next.token;
        this.allowed = new Set((next.allowed ?? []).map(String));
        this.api = this.token ? `https://api.telegram.org/bot${this.token}` : null;
        this.me = null;
        this.offset = 0;

        if (this.token) {
            await this.start();
        }

        return this.status();

    }

    /** Terima array atau string berpisah-koma jadi array bersih. */
    parseAllowedList(value) {

        if (Array.isArray(value)) {
            return value.map(v => String(v).trim()).filter(Boolean);
        }

        return String(value ?? "")
            .split(",")
            .map(s => s.trim())
            .filter(Boolean);

    }

    /** Loop long-polling. Tahan terhadap error jaringan sementara. */
    async loop() {

        while (this.running) {

            try {

                const updates = await this.getUpdates();

                for (const update of updates) {

                    this.offset = update.update_id + 1;

                    // Jangan biarkan satu pesan yang gagal
                    // menjatuhkan loop.
                    this.handleUpdate(update).catch(error => {
                        telemetry.warn(`[telegram] gagal proses pesan: ${error.message}`);
                    });

                }

            }

            catch (error) {

                if (!this.running) {
                    break;
                }

                if (error.name !== "AbortError") {
                    this.lastError = error.message;
                    // Jeda singkat sebelum menyambung lagi supaya
                    // tidak membanjiri saat jaringan putus.
                    await this.sleep(3000);
                }

            }

        }

    }

    async getUpdates() {

        this.pollController = new AbortController();

        const timer = setTimeout(() => this.pollController.abort(), 35000);

        try {

            const data = await this.call("getUpdates", {
                offset: this.offset,
                timeout: 30,
                allowed_updates: ["message"]
            }, this.pollController.signal);

            return data ?? [];

        }

        finally {
            clearTimeout(timer);
        }

    }

    async handleUpdate(update) {

        const message = update.message;

        if (!message?.text) {
            return;
        }

        const chatId = message.chat.id;
        const text = message.text.trim();
        const from = message.from?.first_name ?? "?";

        // /id dan /start selalu boleh — supaya pengguna bisa
        // menemukan chat id-nya untuk didaftarkan.
        if (/^\/(id|start)\b/.test(text)) {
            return this.sendId(chatId, from);
        }

        if (!this.isAllowed(chatId)) {

            await this.send(
                chatId,
                "Maaf, kamu belum diizinkan. Minta pemilik menambahkan " +
                `chat id ini (${chatId}) ke AETHER_TELEGRAM_ALLOWED.`
            );

            telemetry.warn(`[telegram] pesan ditolak dari chat ${chatId} (${from})`);

            return;

        }

        telemetry.publish("telegram:message", { chatId, preview: text.slice(0, 60) });

        if (text.startsWith("/")) {
            return this.handleCommand(chatId, text);
        }

        return this.converse(chatId, text);

    }

    async handleCommand(chatId, text) {

        const [cmd, ...rest] = text.slice(1).split(/\s+/);
        const arg = rest.join(" ").trim();

        switch (cmd.toLowerCase()) {

            case "help":
                return this.send(chatId,
                    "Perintah:\n" +
                    "/status — kesiapan sistem\n" +
                    "/recall <kata> — cari memori\n" +
                    "/reset — lupakan konteks percakapan\n" +
                    "/id — tampilkan chat id\n\n" +
                    "Selain itu, ketik apa saja untuk ngobrol."
                );

            case "status":
                return this.sendStatus(chatId);

            case "recall":
                return this.sendRecall(chatId, arg);

            case "reset":
                this.sessions.delete(chatId);
                return this.send(chatId, "Oke, konteks percakapan kukosongkan.");

            default:
                return this.send(chatId, `Perintah tidak dikenal: /${cmd}`);

        }

    }

    /** Teruskan ke otak Aether (lengkap dengan memori & tool). */
    async converse(chatId, text) {

        const aiRuntime = require("./aiRuntimeService");

        const session = this.sessions.get(chatId) ?? [];

        session.push({ role: "user", content: text });

        // Beri sinyal "sedang mengetik" selama Aether berpikir.
        this.call("sendChatAction", { chat_id: chatId, action: "typing" })
            .catch(() => {});

        try {

            const response = await aiRuntime.chat({
                messages: session.map(({ role, content }) => ({ role, content }))
            });

            const answer = response.content?.trim() || "(tidak ada jawaban)";

            session.push({ role: "assistant", content: answer });

            // Batasi riwayat agar tidak membengkak.
            while (session.length > 20) {
                session.shift();
            }

            this.sessions.set(chatId, session);

            await this.send(chatId, answer);

        }

        catch (error) {

            await this.send(chatId, `Maaf, ada kendala: ${error.message}`);

        }

    }

    async sendStatus(chatId) {

        const telemetryStats = telemetry.stats();

        let providerLine = "";

        try {
            const aiRuntime = require("./aiRuntimeService");
            const providers = await aiRuntime.providers();
            providerLine =
                `\nAI: ${providers.active} · model ${aiRuntime.defaultModel ?? "default"}`;
        }
        catch { /* opsional */ }

        await this.send(chatId,
            `Aether aktif ✅` +
            `\nCPU ${telemetryStats.cpu.usage}% · RAM ${telemetryStats.memory.usedPercent}%` +
            `\nUptime ${Math.round(telemetryStats.daemon.uptime / 60)} menit` +
            providerLine
        );

    }

    async sendRecall(chatId, query) {

        if (!query) {
            return this.send(chatId, "Contoh: /recall ulang tahun");
        }

        const memory = require("../memory/services/MemoryService");

        const result = await memory.recall(query, { limit: 5 });

        if (result.items.length === 0) {
            return this.send(chatId, "Tidak ada memori yang cocok.");
        }

        const lines = result.items
            .map(item => `• ${item.content}`)
            .join("\n");

        await this.send(chatId, `Yang kuingat:\n${lines}`);

    }

    sendId(chatId, name) {

        const allowed = this.isAllowed(chatId);

        return this.send(chatId,
            `Halo ${name}! 👋\n\n` +
            `Chat id kamu: ${chatId}\n` +
            (allowed
                ? "Kamu sudah diizinkan. Ketik apa saja untuk ngobrol dengan Aether."
                : "Untuk mengaktifkan, tambahkan id ini ke AETHER_TELEGRAM_ALLOWED " +
                  "di .env daemon, lalu jalankan ulang.")
        );

    }

    // ---- Kirim -----------------------------------------------------

    /** Kirim pesan; potong bila melebihi batas 4096 karakter Telegram. */
    async send(chatId, text) {

        const chunks = this.splitMessage(String(text ?? ""));

        for (const chunk of chunks) {
            await this.call("sendMessage", {
                chat_id: chatId,
                text: chunk,
                disable_web_page_preview: true
            }).catch(error => {
                telemetry.warn(`[telegram] gagal kirim: ${error.message}`);
            });
        }

    }

    /**
     * Kirim notifikasi proaktif ke semua chat yang diizinkan.
     * Dipakai kelak oleh event CCTV/sensor/backup, dst.
     */
    async broadcast(text) {

        if (!this.running || this.allowed.size === 0) {
            return 0;
        }

        for (const chatId of this.allowed) {
            await this.send(chatId, text);
        }

        return this.allowed.size;

    }

    splitMessage(text, limit = 4000) {

        if (text.length <= limit) {
            return [text];
        }

        const chunks = [];

        for (let i = 0; i < text.length; i += limit) {
            chunks.push(text.slice(i, i + limit));
        }

        return chunks;

    }

    // ---- Telegram API ---------------------------------------------

    async call(method, params = {}, signal = null) {

        if (!this.api) {
            throw new Error("Telegram belum dikonfigurasi.");
        }

        const response = await fetch(`${this.api}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal
        });

        const data = await response.json().catch(() => null);

        if (!data?.ok) {
            throw new Error(
                data?.description ?? `Telegram ${method} gagal (${response.status})`
            );
        }

        return data.result;

    }

    status() {

        return {
            configured: this.configured,
            running: this.running,
            username: this.me?.username ?? null,
            allowed: [...this.allowed],
            allowedCount: this.allowed.size,
            openMode: this.allowed.size === 0,
            hasToken: Boolean(this.token),
            tokenHint: this.token
                ? `${String(this.token).slice(0, 6)}…${String(this.token).slice(-4)}`
                : null,
            lastError: this.lastError,
            startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null
        };

    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

}

module.exports = new TelegramService();
