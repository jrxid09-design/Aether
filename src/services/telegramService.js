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

        /** Jendela sesi grup (chatId → kedaluwarsa ms). */
        this.groupSessions = new Map();

        /** Chat yang sedang dilayani — dibaca tool kirim media. */
        this.currentChatId = null;

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

        if (!message) {
            return;
        }

        const chat = message.chat;
        const chatId = chat.id;
        const isGroup = chat.type === "group" || chat.type === "supergroup";
        const fromId = message.from?.id;
        const fromName = message.from?.first_name ?? "?";
        const text = (message.text ?? message.caption ?? "").trim();

        // /id & /start selalu boleh (agar pengguna tahu chat id-nya).
        if (/^\/(id|start)\b/.test(text)) {
            return this.sendId(chatId, fromName);
        }

        // Izin: privat → chat harus diizinkan; grup → grup ATAU
        // pengirim (pemilik) diizinkan.
        const allowed = isGroup
            ? (this.isAllowed(chatId) || this.isAllowed(fromId))
            : this.isAllowed(chatId);

        if (!allowed) {
            // Di grup jangan berisik menolak; hanya balas di privat.
            if (!isGroup) {
                await this.send(chatId,
                    `Maaf, kamu belum diizinkan. Chat id ini: ${chatId}. ` +
                    "Minta pemilik menambahkannya di Settings → Telegram.");
                telemetry.warn(`[telegram] ditolak dari ${chatId} (${fromName})`);
            }
            return;
        }

        // Di grup: hanya respon bila di-mention/di-reply, ATAU sesi
        // percakapan sedang aktif (dalam 15 detik terakhir).
        if (isGroup) {
            const mentioned = this.isMentioned(message, text);
            if (mentioned || this.sessionActive(chatId)) {
                this.touchSession(chatId);
            }
            else {
                return; // grup, tanpa mention, di luar sesi → abaikan
            }
        }

        telemetry.publish("telegram:message", {
            chatId, group: isGroup, preview: text.slice(0, 60)
        });

        // Media masuk (foto/dokumen/video/stiker) → dianalisis Aether.
        if (message.photo || message.document || message.video || message.sticker) {
            return this.handleMedia(chatId, message, this.stripMention(text));
        }

        if (text.startsWith("/")) {
            return this.handleCommand(chatId, text);
        }

        if (!text) {
            return;
        }

        return this.converse(chatId, this.stripMention(text));

    }

    /** Apakah pesan grup men-mention / me-reply bot? */
    isMentioned(message, text) {

        const username = this.me?.username;

        // Reply ke pesan bot.
        if (message.reply_to_message?.from?.id === this.me?.id) {
            return true;
        }

        const entities = message.entities ?? message.caption_entities ?? [];

        for (const e of entities) {

            if (e.type === "text_mention" && e.user?.id === this.me?.id) {
                return true;
            }

            if (e.type === "mention" && username) {
                const slice = (message.text ?? message.caption ?? "")
                    .substr(e.offset, e.length).toLowerCase();
                if (slice === `@${username.toLowerCase()}`) {
                    return true;
                }
            }

        }

        // Fallback: nama disebut langsung.
        return username
            ? new RegExp(`@${username}`, "i").test(text) || /\baether\b/i.test(text)
            : /\baether\b/i.test(text);

    }

    stripMention(text) {
        const username = this.me?.username;
        let out = String(text ?? "");
        if (username) {
            out = out.replace(new RegExp(`@${username}`, "ig"), "");
        }
        return out.trim();
    }

    /** Sesi grup: hidup 15 detik sejak pesan terakhir yang direspon. */
    sessionActive(chatId) {
        const until = this.groupSessions.get(chatId);
        return until && Date.now() < until;
    }

    touchSession(chatId) {
        this.groupSessions.set(chatId, Date.now() + 15000);
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

        // Tool kirim-media membaca ini untuk tahu chat tujuan.
        this.currentChatId = chatId;

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

    /**
     * Tangani media masuk: foto & gambar dianalisis model vision,
     * berkas teks dibaca, video dianalisis dari thumbnail-nya.
     */
    async handleMedia(chatId, message, caption) {

        this.currentChatId = chatId;

        this.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

        const vision = require("./visionService");

        try {

            // --- Foto ---
            if (message.photo?.length) {
                const largest = message.photo[message.photo.length - 1];
                const { buffer } = await this.downloadFile(largest.file_id);
                const r = await vision.analyze({
                    imageBase64: buffer.toString("base64"),
                    mimeType: "image/jpeg",
                    prompt: caption || undefined
                });
                return this.replyWithMemory(chatId, caption, r.text, "gambar");
            }

            // --- Stiker (punya thumbnail/emoji) ---
            if (message.sticker) {
                const emoji = message.sticker.emoji ?? "";
                const fileId = message.sticker.thumb?.file_id ?? message.sticker.file_id;
                try {
                    const { buffer } = await this.downloadFile(fileId);
                    const r = await vision.analyze({
                        imageBase64: buffer.toString("base64"),
                        prompt: "Deskripsikan stiker ini singkat."
                    });
                    return this.send(chatId, `${emoji} ${r.text}`);
                }
                catch {
                    return this.send(chatId, `Stiker ${emoji} diterima.`);
                }
            }

            // --- Video: pakai thumbnail ---
            if (message.video) {
                const thumb = message.video.thumb ?? message.video.thumbnail;
                if (thumb) {
                    const { buffer } = await this.downloadFile(thumb.file_id);
                    const r = await vision.analyze({
                        imageBase64: buffer.toString("base64"),
                        prompt: (caption || "Deskripsikan isi video ini") + " (dari thumbnail)."
                    });
                    return this.send(chatId, `📹 (dari cuplikan video)\n${r.text}`);
                }
                return this.send(chatId, "Video diterima, tapi tak ada cuplikan untuk dianalisis.");
            }

            // --- Dokumen ---
            if (message.document) {
                const doc = message.document;
                const mime = doc.mime_type ?? "";

                if (mime.startsWith("image/")) {
                    const { buffer } = await this.downloadFile(doc.file_id);
                    const r = await vision.analyze({
                        imageBase64: buffer.toString("base64"),
                        mimeType: mime,
                        prompt: caption || undefined
                    });
                    return this.replyWithMemory(chatId, caption, r.text, "gambar");
                }

                if (mime.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(doc.file_name ?? "")) {
                    const { buffer } = await this.downloadFile(doc.file_id);
                    const content = buffer.toString("utf8").slice(0, 6000);
                    return this.converse(chatId,
                        `${caption || "Tolong ringkas/analisis isi berkas ini"} ` +
                        `(${doc.file_name}):\n\n${content}`);
                }

                return this.send(chatId,
                    `Berkas "${doc.file_name}" (${mime || "tipe tak dikenal"}) diterima, ` +
                    "tapi jenis ini belum bisa kuanalisis.");
            }

        }

        catch (error) {

            if (error.code === "VISION_NOT_CONFIGURED") {
                return this.send(chatId,
                    "Aku menerima medianya, tapi model vision belum diatur. " +
                    "Set model vision (mis. llava) di Console → Vision.");
            }

            return this.send(chatId, `Gagal menganalisis media: ${error.message}`);

        }

    }

    /** Kirim hasil analisis vision, sekaligus lewat otak agar natural. */
    async replyWithMemory(chatId, caption, seen, kind) {

        // Bila ada pertanyaan (caption), biarkan LLM menjawab
        // berdasarkan hasil penglihatan; kalau tidak, kirim deskripsi.
        if (caption) {
            return this.converse(chatId,
                `[Aether melihat ${kind}: ${seen}]\n\nPertanyaan: ${caption}`);
        }

        return this.send(chatId, seen);

    }

    /** Unduh berkas Telegram → Buffer. */
    async downloadFile(fileId) {

        const file = await this.call("getFile", { file_id: fileId });

        const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Unduh berkas gagal (${response.status})`);
        }

        return {
            buffer: Buffer.from(await response.arrayBuffer()),
            path: file.file_path
        };

    }

    // ---- Kirim media (dipakai tool) ------------------------------

    async sendPhoto(chatId, photoUrl, caption) {
        return this.call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
    }

    async sendDocument(chatId, docUrl, caption) {
        return this.call("sendDocument", { chat_id: chatId, document: docUrl, caption });
    }

    async sendSticker(chatId, sticker) {
        return this.call("sendSticker", { chat_id: chatId, sticker });
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
