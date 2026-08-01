const { EventEmitter } = require("node:events");

/**
 * Satu sesi terminal = satu proses pty (node-pty) + scrollback ring.
 *
 * Ring buffer inilah yang membuat terminal BISA DIBAGI: klien yang
 * baru attach (atau AI yang read()) memutar ulang buffer sehingga
 * semua melihat layar yang sama. Session tak me-require node-pty
 * sendiri — instance pty disuntikkan oleh TerminalRuntime agar
 * require malas terpusat di satu tempat.
 *
 * Emit:
 *   "data" (string)  — output pty (untuk WS/stream & execute)
 *   "exit" (code)    — proses berakhir
 */

const MAX_BUFFER = 256 * 1024;   // ponytail: ring 256KB; cukup utk 1 layar penuh + histori

class TerminalSession extends EventEmitter {

    constructor({ id, name, shell, cwd, pty, cols, rows }) {
        super();
        this.id = id;
        this.name = name;
        this.shell = shell;
        this.cwd = cwd;
        this.cols = cols;
        this.rows = rows;
        this.pid = pty.pid;
        this.status = "running";
        this.exitCode = null;
        this.startedAt = Date.now();
        this.pty = pty;

        this._chunks = [];
        this._bytes = 0;

        pty.onData(d => this._onData(d));
        pty.onExit(e => {
            this.status = "exited";
            this.exitCode = e?.exitCode ?? 0;
            this.emit("exit", this.exitCode);
        });
    }

    _onData(data) {
        const buf = Buffer.from(data, "utf8");
        this._chunks.push(buf);
        this._bytes += buf.length;
        while (this._bytes > MAX_BUFFER && this._chunks.length > 1) {
            this._bytes -= this._chunks.shift().length;
        }
        this.emit("data", data);
    }

    /** Tulis byte mentah / keystroke ke pty. */
    write(data) {
        if (this.status === "running") this.pty.write(data);
        return true;
    }

    /** Sinyal: SIGINT=Ctrl+C, EOF=Ctrl+D, selain itu → kill proses. */
    signal(name) {
        if (name === "SIGINT") return this.write("\x03");
        if (name === "EOF") return this.write("\x04");
        return this.kill(name);
    }

    resize(cols, rows) {
        this.cols = cols; this.rows = rows;
        try { this.pty.resize(cols, rows); } catch { /* proses mungkin sudah mati */ }
        return true;
    }

    /** Scrollback saat ini (untuk snapshot attach & AI read()). */
    read() {
        return Buffer.concat(this._chunks).toString("utf8");
    }

    /**
     * Jalankan perintah lalu tangkap output sampai `expect` cocok
     * atau timeout. Inilah cara AI "tunggu sampai backend siap"
     * secara deterministik (bukan tebak-tebakan sleep).
     */
    execute(command, { expect, timeoutMs = 15000 } = {}) {
        return new Promise(resolve => {
            let out = "";
            let done = false;
            const re = expect ? (expect instanceof RegExp ? expect : new RegExp(expect, "i")) : null;

            const onData = d => { out += d; if (re && re.test(out)) finish(true); };
            const finish = matched => {
                if (done) return;
                done = true;
                this.off("data", onData);
                clearTimeout(timer);
                resolve({ output: out, matched });
            };

            const timer = setTimeout(() => finish(false), timeoutMs);
            this.on("data", onData);
            this.write(command.endsWith("\n") ? command : command + "\r");
        });
    }

    kill(signal = "SIGKILL") {
        try { this.pty.kill(signal); } catch { /* sudah mati */ }
        this.status = "exited";
        return true;
    }

    meta() {
        return {
            id: this.id,
            name: this.name,
            shell: this.shell,
            cwd: this.cwd,
            pid: this.pid,
            status: this.status,
            exitCode: this.exitCode,
            startedAt: new Date(this.startedAt).toISOString(),
            cols: this.cols,
            rows: this.rows
        };
    }

}

module.exports = TerminalSession;
