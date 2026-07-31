const path = require("node:path");
const fs = require("node:fs");

const telemetry = require("./telemetryService");
const JsonStore = require("../core/config/JsonStore");

/**
 * Jembatan WhatsApp — pengganti Telegram.
 *
 * Memakai Baileys (WhatsApp Web multi-device) via WebSocket: tak
 * perlu Chromium, tak perlu URL publik, jalan di belakang NAT rumah
 * persis seperti long-polling Telegram dulu. Login pakai PAIRING
 * CODE (kode 8 karakter) — pengguna memasukkan nomornya, dapat kode,
 * lalu tempel di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor.
 *
 * Keamanan: hanya melayani nomor yang diizinkan (privat) dan grup
 * yang didaftarkan (di grup Aether menjawab saat di-mention/di-reply).
 *
 * ponytail: Baileys dep berat tapi tak terhindarkan (protokol WA
 * Web bukan "beberapa baris"); di-require malas agar daemon tetap
 * jalan walau paket belum di-`npm install`.
 */

const AUTH_DIR = path.join(__dirname, "..", "..", "configs", "wa-auth");

const store = new JsonStore(
    path.join(__dirname, "..", "..", "configs", "whatsapp.json"),
    { number: null, allowed: [], groups: [] }
);

// Logger no-op berbentuk pino (Baileys memanggil .child()/.level).
const silentLogger = {
    level: "silent",
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return silentLogger; }
};

class WhatsAppService {

    constructor() {

        const saved = store.read();

        this.number = saved.number ?? null;
        this.allowed = new Set((saved.allowed ?? []).map(String));
        this.groups = new Set((saved.groups ?? []).map(String));

        this.sock = null;
        this.connected = false;
        this.me = null;                 // { number }
        this.pairingCode = null;
        this.lastError = null;
        this.startedAt = null;

        // Diagnostik pairing (dibaca Console).
        this.state = "idle";            // connecting | open | close
        this.registered = false;
        this.pairingRequested = false;
        this.lastDisconnect = null;     // { code, reason, at }
        this.reconnectAttempts = 0;
        this.lastConnectedAt = null;
        this.waVersion = null;

        /** Konteks percakapan ringkas per chat (jid). */
        this.sessions = new Map();
        /** Jendela sesi grup (jid → kedaluwarsa ms). */
        this.groupSessions = new Map();
        /** Chat yang sedang dilayani — dibaca tool kirim media. */
        this.currentChatId = null;

        this._baileys = undefined;      // cache hasil require malas
    }

    /** require Baileys secara malas; null bila belum diinstall. */
    lib() {
        if (this._baileys === undefined) {
            try {
                this._baileys = require("@whiskeysockets/baileys");
            }
            catch {
                this._baileys = null;
            }
        }
        return this._baileys;
    }

    get available() {
        return this.lib() !== null;
    }

    get running() {
        return this.connected;
    }

    parseList(value) {
        if (Array.isArray(value)) {
            return value.map(v => String(v).trim()).filter(Boolean);
        }
        return String(value ?? "").split(",").map(s => s.trim()).filter(Boolean);
    }

    /** Cocokkan jid ke daftar nomor izin (bandingkan digit nomornya). */
    isAllowed(jid) {
        if (this.allowed.size === 0) return false;
        const num = String(jid ?? "").split("@")[0].split(":")[0];
        return this.allowed.has(num);
    }

    isGroupRegistered(jid) {
        // Terima id penuh (xxx@g.us) maupun bagian angkanya.
        return this.groups.has(String(jid)) || this.groups.has(String(jid).split("@")[0]);
    }

    // ---- Siklus koneksi ------------------------------------------

    /** Dipanggil saat boot: sambung diam-diam bila sudah pernah tertaut. */
    async start() {
        if (!this.available) {
            telemetry.info("[whatsapp] paket @whiskeysockets/baileys belum diinstall — nonaktif.");
            return this;
        }
        if (fs.existsSync(path.join(AUTH_DIR, "creds.json"))) {
            await this.connect().catch(e => telemetry.warn(`[whatsapp] auto-connect gagal: ${e.message}`));
        }
        return this;
    }

    async connect() {

        const baileys = this.lib();
        if (!baileys) {
            this.lastError = "Paket @whiskeysockets/baileys belum diinstall.";
            throw new Error(this.lastError);
        }

        if (this.sock) return this;    // sudah tersambung/menyambung

        const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = baileys;

        fs.mkdirSync(AUTH_DIR, { recursive: true });
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        this.saveCreds = saveCreds;
        this.registered = Boolean(state.creds.registered);
        this.pairingRequested = false;

        // WAJIB: pakai versi WA-web terkini. Tanpa ini Baileys memakai
        // versi bundel yang bisa usang → server WhatsApp menolak tautan
        // ("Cannot link device") lalu mengirim loggedOut, dan registered
        // tak pernah jadi true.
        const { version } = await fetchLatestBaileysVersion();
        this.waVersion = version;

        const sock = makeWASocket({
            version,
            auth: state,
            logger: silentLogger,
            printQRInTerminal: false,
            browser: Browsers.ubuntu("Aether"),
            markOnlineOnConnect: false,
            syncFullHistory: false
        });

        this.sock = sock;

        // creds.update: simpan + segarkan status registrasi.
        sock.ev.on("creds.update", async () => {
            await saveCreds();
            this.registered = Boolean(sock.authState.creds.registered);
        });
        sock.ev.on("connection.update", (u) => this.onConnection(u));
        sock.ev.on("messages.upsert", (m) => {
            this.onMessages(m).catch(err =>
                telemetry.warn(`[whatsapp] gagal proses pesan: ${err.message}`));
        });

        return this;
    }

    async requestPairing() {
        if (!this.sock || !this.number) return null;
        try {
            const code = await this.sock.requestPairingCode(this.number.replace(/\D/g, ""));
            this.pairingCode = code;
            telemetry.info(`[whatsapp] pairing code: ${code} (tempel di WhatsApp > Perangkat Tertaut)`);
            return code;
        }
        catch (error) {
            this.lastError = `Gagal minta pairing code: ${error.message}`;
            telemetry.warn(`[whatsapp] ${this.lastError}`);
            return null;
        }
    }

    onConnection(update) {
        const { connection, lastDisconnect, qr } = update;

        if (connection) this.state = connection;

        // Socket siap (qr tersedia) & belum tertaut → minta pairing code
        // SEKALI. Ini menggantikan setTimeout buta: qr baru muncul setelah
        // WS benar-benar terbuka, jadi requestPairingCode pasti valid.
        if (qr && this.number && !this.registered && !this.pairingRequested) {
            this.pairingRequested = true;
            this.requestPairing().catch(() => {});
        }

        if (connection === "open") {
            this.connected = true;
            this.registered = true;
            this.pairingRequested = false;
            this.pairingCode = null;
            this.lastError = null;
            this.reconnectAttempts = 0;
            this.lastConnectedAt = Date.now();
            this.startedAt ??= Date.now();
            this.me = { number: String(this.sock?.user?.id ?? "").split(":")[0].split("@")[0] };
            telemetry.info(`[whatsapp] tersambung sebagai ${this.me.number}`);
        }

        if (connection === "close") {
            this.connected = false;
            this.pairingRequested = false;

            const DR = this.lib()?.DisconnectReason ?? {};
            const code = lastDisconnect?.error?.output?.statusCode ?? null;
            this.lastDisconnect = {
                code,
                reason: lastDisconnect?.error?.message ?? null,
                at: Date.now()
            };

            const loggedOut = code === (DR.loggedOut ?? 401);
            this.sock = null;

            if (loggedOut) {
                // Kredensial tak valid lagi — jangan reconnect loop.
                telemetry.warn(`[whatsapp] loggedOut (${code}) — tautkan ulang dari Settings.`);
            }
            else {
                // Termasuk restartRequired (515) setelah pairing sukses:
                // WAJIB reconnect untuk merampungkan sesi.
                this.reconnectAttempts = (this.reconnectAttempts ?? 0) + 1;
                telemetry.info(`[whatsapp] connection close (${code}) — reconnect #${this.reconnectAttempts}`);
                setTimeout(() => this.connect().catch(() => {}), 3000);
            }
        }
    }

    async logout() {
        try { await this.sock?.logout(); } catch { /* abaikan */ }
        this.sock = null;
        this.connected = false;
        this.me = null;
        this.pairingCode = null;
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        return this.status();
    }

    stop() {
        try { this.sock?.end?.(); } catch { /* abaikan */ }
        this.sock = null;
        this.connected = false;
    }

    /** Simpan setelan dari Settings lalu (re)connect untuk pairing. */
    async reconfigure({ number, allowed, groups } = {}) {
        const current = store.read();
        const next = {
            number: number !== undefined ? (number || null) : current.number,
            allowed: allowed !== undefined ? this.parseList(allowed) : (current.allowed ?? []),
            groups: groups !== undefined ? this.parseList(groups) : (current.groups ?? [])
        };
        store.write(next);

        this.number = next.number;
        this.allowed = new Set(next.allowed.map(String));
        this.groups = new Set(next.groups.map(String));

        // Bila sudah tersambung, cukup update daftar izin (di atas).
        // Bila belum tertaut & ada nomor, sambungkan untuk dapat kode.
        if (!this.connected && this.number && this.available) {
            await this.connect();
            await this.requestPairing();
        }
        return this.status();
    }

    // ---- Pesan masuk ---------------------------------------------

    async onMessages({ messages, type }) {
        if (type !== "notify") return;

        for (const msg of messages ?? []) {
            if (!msg.message || msg.key?.fromMe) continue;
            await this.handle(msg).catch(err =>
                telemetry.warn(`[whatsapp] handle gagal: ${err.message}`));
        }
    }

    async handle(msg) {

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith("@g.us");
        const senderJid = isGroup ? (msg.key.participant ?? "") : jid;
        const text = this.extractText(msg).trim();

        // /id & /start selalu boleh (agar pengguna tahu id-nya).
        if (/^\/(id|start)\b/i.test(text)) {
            return this.sendId(jid, senderJid, isGroup);
        }

        // Izin: privat → nomor diizinkan; grup → grup terdaftar ATAU
        // pengirim diizinkan.
        const allowed = isGroup
            ? (this.isGroupRegistered(jid) || this.isAllowed(senderJid))
            : this.isAllowed(jid);

        if (!allowed) {
            if (!isGroup) {
                await this.send(jid,
                    `Maaf, kamu belum diizinkan. Nomor ini: ${jid.split("@")[0]}. ` +
                    "Minta pemilik menambahkannya di Console → Settings → WhatsApp.", msg);
            }
            return;
        }

        // Di grup: hanya respon bila di-mention/di-reply atau sesi aktif.
        if (isGroup) {
            if (this.isMentioned(msg, text) || this.sessionActive(jid)) {
                this.touchSession(jid);
            }
            else {
                return;
            }
        }

        telemetry.publish("whatsapp:message", {
            jid, group: isGroup, preview: text.slice(0, 60)
        });

        const media = this.mediaType(msg);
        if (media) {
            return this.handleMedia(jid, msg, media, this.stripMention(text));
        }

        if (text.startsWith("/")) {
            return this.handleCommand(jid, text, msg);
        }

        if (!text) return;

        return this.converse(jid, this.stripMention(text), msg);
    }

    extractText(msg) {
        const m = msg.message ?? {};
        return (
            m.conversation ??
            m.extendedTextMessage?.text ??
            m.imageMessage?.caption ??
            m.videoMessage?.caption ??
            m.documentMessage?.caption ??
            ""
        );
    }

    mediaType(msg) {
        const m = msg.message ?? {};
        if (m.imageMessage) return "image";
        if (m.stickerMessage) return "sticker";
        if (m.videoMessage) return "video";
        if (m.audioMessage) return "audio";
        if (m.documentMessage) return "document";
        return null;
    }

    isMentioned(msg, text) {
        const meId = this.sock?.user?.id ?? "";
        const meNum = meId.split(":")[0].split("@")[0];
        const ctx = msg.message?.extendedTextMessage?.contextInfo;

        // Reply ke pesan bot.
        if (ctx?.participant && ctx.participant.split(":")[0].split("@")[0] === meNum) {
            return true;
        }
        // Mention eksplisit.
        if ((ctx?.mentionedJid ?? []).some(j => j.split("@")[0] === meNum)) {
            return true;
        }
        // Nama disebut.
        return /\baether\b/i.test(text);
    }

    stripMention(text) {
        return String(text ?? "").replace(/@\d+/g, "").trim();
    }

    sessionActive(jid) {
        const until = this.groupSessions.get(jid);
        return until && Date.now() < until;
    }

    touchSession(jid) {
        this.groupSessions.set(jid, Date.now() + 15000);
    }

    async handleCommand(jid, text, msg) {
        const [cmd, ...rest] = text.slice(1).split(/\s+/);
        const arg = rest.join(" ").trim();

        switch (cmd.toLowerCase()) {
            case "help":
                return this.send(jid,
                    "Perintah:\n/status — kesiapan sistem\n/recall <kata> — cari memori\n" +
                    "/reset — lupakan konteks\n/id — tampilkan id\n\nSelain itu, ketik apa saja untuk ngobrol.", msg);
            case "status":
                return this.sendStatus(jid, msg);
            case "recall":
                return this.sendRecall(jid, arg, msg);
            case "reset":
                this.sessions.delete(jid);
                return this.send(jid, "Oke, konteks percakapan kukosongkan.", msg);
            default:
                return this.send(jid, `Perintah tidak dikenal: /${cmd}`, msg);
        }
    }

    /** Teruskan ke otak Aether (lengkap memori & tool). */
    async converse(jid, text, msg) {
        const aiRuntime = require("./aiRuntimeService");
        this.currentChatId = jid;

        const session = this.sessions.get(jid) ?? [];
        session.push({ role: "user", content: text });

        this.sock?.sendPresenceUpdate?.("composing", jid).catch(() => {});

        try {
            const response = await aiRuntime.chat({
                messages: session.map(({ role, content }) => ({ role, content }))
            });
            const answer = response.content?.trim() || "(tidak ada jawaban)";
            session.push({ role: "assistant", content: answer });
            while (session.length > 20) session.shift();
            this.sessions.set(jid, session);
            await this.send(jid, answer, msg);
        }
        catch (error) {
            await this.send(jid, `Maaf, ada kendala: ${error.message}`, msg);
        }
    }

    /** Media masuk: gambar/stiker → vision, dokumen teks → baca,
     *  audio (voice note) → STT, video → thumbnail. */
    async handleMedia(jid, msg, kind, caption) {
        this.currentChatId = jid;
        this.sock?.sendPresenceUpdate?.("composing", jid).catch(() => {});

        const vision = require("./visionService");

        try {
            if (kind === "image" || kind === "sticker") {
                const buffer = await this.download(msg);
                const r = await vision.analyze({
                    imageBase64: buffer.toString("base64"),
                    mimeType: kind === "sticker" ? "image/webp" : "image/jpeg",
                    prompt: caption || undefined
                });
                return this.replyWithMemory(jid, caption, r.text, "gambar", msg);
            }

            if (kind === "video") {
                // ponytail: pakai thumbnail bawaan pesan (jpegThumbnail);
                // ekstraksi frame penuh butuh ffmpeg — tambah nanti bila perlu.
                const thumb = msg.message?.videoMessage?.jpegThumbnail;
                if (thumb?.length) {
                    const r = await vision.analyze({
                        imageBase64: Buffer.from(thumb).toString("base64"),
                        prompt: (caption || "Deskripsikan isi video ini") + " (dari cuplikan)."
                    });
                    return this.send(jid, `📹 (dari cuplikan)\n${r.text}`, msg);
                }
                return this.send(jid, "Video diterima, tapi tak ada cuplikan untuk dianalisis.", msg);
            }

            if (kind === "audio") {
                const buffer = await this.download(msg);
                try {
                    const stt = require("./voiceService");
                    const { text } = await stt.transcribe(buffer, { mimeType: "audio/ogg", language: "id" });
                    if (text?.trim()) {
                        return this.converse(jid, text.trim(), msg);
                    }
                }
                catch (error) {
                    if (error.code === "STT_NOT_CONFIGURED") {
                        return this.send(jid, "Voice note diterima, tapi STT belum diatur di Settings → Suara.", msg);
                    }
                    throw error;
                }
                return this.send(jid, "Voice note diterima, tapi tak terdengar isinya.", msg);
            }

            if (kind === "document") {
                const doc = msg.message.documentMessage;
                const mime = doc.mimetype ?? "";
                const name = doc.fileName ?? "berkas";
                if (mime.startsWith("image/")) {
                    const buffer = await this.download(msg);
                    const r = await vision.analyze({
                        imageBase64: buffer.toString("base64"), mimeType: mime, prompt: caption || undefined
                    });
                    return this.replyWithMemory(jid, caption, r.text, "gambar", msg);
                }
                if (mime.startsWith("text/") || /\.(txt|md|csv|json|log)$/i.test(name)) {
                    const buffer = await this.download(msg);
                    const content = buffer.toString("utf8").slice(0, 6000);
                    return this.converse(jid,
                        `${caption || "Tolong ringkas/analisis isi berkas ini"} (${name}):\n\n${content}`, msg);
                }
                return this.send(jid, `Berkas "${name}" (${mime || "tipe tak dikenal"}) diterima, tapi jenis ini belum bisa kuanalisis.`, msg);
            }
        }
        catch (error) {
            if (error.code === "VISION_NOT_CONFIGURED") {
                return this.send(jid, "Aku terima medianya, tapi model vision belum diatur (Console → Vision).", msg);
            }
            return this.send(jid, `Gagal menganalisis media: ${error.message}`, msg);
        }
    }

    async replyWithMemory(jid, caption, seen, jenis, msg) {
        if (caption) {
            return this.converse(jid, `[Aether melihat ${jenis}: ${seen}]\n\nPertanyaan: ${caption}`, msg);
        }
        return this.send(jid, seen, msg);
    }

    /** Unduh media pesan → Buffer. */
    async download(msg) {
        const { downloadMediaMessage } = this.lib();
        return downloadMediaMessage(msg, "buffer", {}, {
            logger: silentLogger,
            reuploadRequest: this.sock.updateMediaMessage
        });
    }

    // ---- Kirim ---------------------------------------------------

    /** Kirim teks, quote pesan asal bila ada. Potong >4096 char. */
    async send(jid, text, quoted = null) {
        const opts = quoted ? { quoted } : {};
        for (const chunk of this.splitMessage(String(text ?? ""))) {
            await this.sock?.sendMessage(jid, { text: chunk }, opts)
                .catch(err => telemetry.warn(`[whatsapp] gagal kirim: ${err.message}`));
        }
    }

    async sendPhoto(jid, url, caption) {
        return this.sock?.sendMessage(jid, { image: { url }, caption: caption || undefined });
    }

    async sendDocument(jid, url, caption, fileName = "berkas") {
        return this.sock?.sendMessage(jid, { document: { url }, fileName, caption: caption || undefined });
    }

    async sendSticker(jid, url) {
        return this.sock?.sendMessage(jid, { sticker: { url } });
    }

    async sendReaction(jid, key, emoji = "👍") {
        return this.sock?.sendMessage(jid, { react: { text: emoji, key } });
    }

    async broadcast(text) {
        if (!this.connected || this.allowed.size === 0) return 0;
        for (const num of this.allowed) {
            await this.send(`${num}@s.whatsapp.net`, text);
        }
        return this.allowed.size;
    }

    splitMessage(text, limit = 4000) {
        if (text.length <= limit) return [text];
        const chunks = [];
        for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
        return chunks;
    }

    // ---- Perintah bawaan ----------------------------------------

    async sendStatus(jid, msg) {
        const s = telemetry.stats();
        let providerLine = "";
        try {
            const aiRuntime = require("./aiRuntimeService");
            const p = await aiRuntime.providers();
            providerLine = `\nAI: ${p.active} · model ${aiRuntime.defaultModel ?? "default"}`;
        }
        catch { /* opsional */ }
        await this.send(jid,
            `Aether aktif ✅\nCPU ${s.cpu.usage}% · RAM ${s.memory.usedPercent}%` +
            `\nUptime ${Math.round(s.daemon.uptime / 60)} menit${providerLine}`, msg);
    }

    async sendRecall(jid, query, msg) {
        if (!query) return this.send(jid, "Contoh: /recall ulang tahun", msg);
        const memory = require("../memory/services/MemoryService");
        const result = await memory.recall(query, { limit: 5 });
        if (result.items.length === 0) return this.send(jid, "Tidak ada memori yang cocok.", msg);
        await this.send(jid, "Yang kuingat:\n" + result.items.map(i => `• ${i.content}`).join("\n"), msg);
    }

    sendId(jid, senderJid, isGroup) {
        const num = (isGroup ? senderJid : jid).split("@")[0];
        const groupId = isGroup ? `\nId grup ini: ${jid}` : "";
        return this.send(jid,
            `Nomor kamu: ${num}${groupId}\n\n` +
            "Untuk mengaktifkan, tambahkan di Console → Settings → WhatsApp " +
            "(nomor izin, atau id grup bila ini grup).", jid.endsWith("@g.us") ? null : undefined);
    }

    status() {
        return {
            available: this.available,
            configured: Boolean(this.number) || this.connected,
            connected: this.connected,
            state: this.state,
            registered: Boolean(this.registered),
            number: this.me?.number ?? null,
            pairingCode: this.pairingCode,
            pairNumber: this.number,
            allowed: [...this.allowed],
            allowedCount: this.allowed.size,
            groups: [...this.groups],
            groupCount: this.groups.size,
            lastError: this.lastError,
            lastDisconnect: this.lastDisconnect
                ? { ...this.lastDisconnect, at: new Date(this.lastDisconnect.at).toISOString() }
                : null,
            reconnectAttempts: this.reconnectAttempts,
            connectedAt: this.lastConnectedAt ? new Date(this.lastConnectedAt).toISOString() : null,
            startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
            waVersion: this.waVersion ? this.waVersion.join(".") : null,
            note: this.available ? null : "Jalankan: npm install @whiskeysockets/baileys"
        };
    }
}

module.exports = new WhatsAppService();
