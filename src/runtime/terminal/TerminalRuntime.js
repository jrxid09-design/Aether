const crypto = require("node:crypto");

const TerminalSession = require("./TerminalSession");
const shells = require("./shells");
const store = require("./terminalStore");
const telemetry = require("../../services/telemetryService");

/**
 * TerminalRuntime — manajer sesi terminal persisten milik daemon.
 *
 * Hidup di daemon (bukan Electron) supaya: (1) AI & pengguna berbagi
 * pty yang SAMA, (2) sesi bertahan meski Console ditutup, (3) jalan
 * headless. node-pty di-require MALAS (seperti baileys/qrcode) → daemon
 * tetap hidup walau paket belum diinstall.
 *
 * API bersama dipakai oleh: REST (pengguna/CLI), WebSocket (stream),
 * dan tool AI (in-process) — ketiganya bermuara ke sini.
 */
class TerminalRuntime {

    constructor() {
        this.sessions = new Map();
        this._pty = undefined;
    }

    lib() {
        if (this._pty === undefined) {
            try { this._pty = require("node-pty"); }
            catch { this._pty = null; }
        }
        return this._pty;
    }

    get available() {
        return this.lib() !== null;
    }

    start() {
        if (!this.available) {
            telemetry.info("[terminal] node-pty belum diinstall — runtime terminal nonaktif (npm install node-pty).");
        }
        // v1: tidak me-respawn proses lama (ceiling terdokumentasi).
        // Metadata tersimpan tetap bisa ditawarkan buka-ulang lewat saved().
        return this;
    }

    stop() {
        this.persist();
        for (const s of this.sessions.values()) {
            try { s.kill(); } catch { /* abaikan */ }
        }
        this.sessions.clear();
    }

    // ---- API bersama ---------------------------------------------

    create({ shell, cwd, name, cols = 120, rows = 30, env } = {}) {
        const pty = this.lib();
        if (!pty) throw new Error("node-pty belum diinstall (npm install node-pty).");

        const sh = shells.resolve(shell);
        const id = "t_" + crypto.randomBytes(4).toString("hex");
        const workdir = cwd || process.env.USERPROFILE || process.env.HOME || process.cwd();

        const proc = pty.spawn(sh.path, sh.args, {
            name: "xterm-256color",
            cols, rows,
            cwd: workdir,
            env: { ...process.env, ...(env || {}), TERM: "xterm-256color" }
        });

        const session = new TerminalSession({
            id, name: name || sh.name, shell: sh.id, cwd: workdir, pty: proc, cols, rows
        });
        session.on("exit", code => telemetry.publish("terminal:exited", { id, code }));

        this.sessions.set(id, session);
        telemetry.publish("terminal:created", { id, shell: sh.id, name: session.name });
        this.persist();

        return session.meta();
    }

    list() {
        return [...this.sessions.values()].map(s => s.meta());
    }

    get(id) {
        return this.sessions.get(id) || null;
    }

    findByName(name) {
        const n = String(name || "").toLowerCase();
        return [...this.sessions.values()].find(s => s.name.toLowerCase() === n) || null;
    }

    /**
     * Cari-atau-buat berdasarkan nama — inti aturan AI "jangan spawn
     * shell sementara". Kembalikan session (bukan meta) untuk dipakai
     * internal/tool.
     */
    ensureSession({ name, shell, cwd } = {}) {
        const existing = this.findByName(name);
        if (existing && existing.status === "running") return existing;
        const meta = this.create({ name, shell, cwd });
        return this.get(meta.id);
    }

    write(id, data) { return this.req(id).write(data); }
    signal(id, name) { return this.req(id).signal(name); }
    resize(id, cols, rows) { return this.req(id).resize(cols, rows) && this.req(id).meta(); }
    read(id) { return this.req(id).read(); }
    execute(id, command, opts) { return this.req(id).execute(command, opts); }

    rename(id, name) {
        const s = this.req(id);
        s.name = name;
        this.persist();
        return s.meta();
    }

    kill(id) { return this.req(id).kill(); }

    close(id) {
        const s = this.get(id);
        if (s) {
            try { s.kill(); } catch { /* abaikan */ }
            this.sessions.delete(id);
            this.persist();
        }
        return true;
    }

    /** Metadata terminal tersimpan dari sesi daemon sebelumnya (untuk buka-ulang). */
    saved() {
        return store.read().terminals || [];
    }

    /** Buka-ulang tab tersimpan (shell baru di cwd yang sama). */
    restore(id) {
        const meta = this.saved().find(t => t.id === id);
        if (!meta) throw new Error(`Terminal tersimpan '${id}' tidak ada.`);
        return this.create({ shell: meta.shell, cwd: meta.cwd, name: meta.name });
    }

    availableShells() {
        return shells.detect().map(s => ({ id: s.id, name: s.name }));
    }

    // ---- internal -------------------------------------------------

    req(id) {
        const s = this.get(id);
        if (!s) throw new Error(`Terminal '${id}' tidak ada.`);
        return s;
    }

    persist() {
        store.write({
            terminals: this.list().map(m => ({ id: m.id, name: m.name, shell: m.shell, cwd: m.cwd }))
        });
    }

}

module.exports = new TerminalRuntime();
