/**
 * Backend pty LOKAL (node-pty). Satu-satunya backend konkret saat ini.
 *
 * Seam untuk masa depan: backend lain (Docker/SSH/Remote) cukup
 * mengekspor bentuk yang sama — { id, available, spawn(opts) } yang
 * mengembalikan handle mirip-pty: { pid, onData, onExit, write, resize, kill }.
 * TerminalRuntime memilih backend via descriptor.target, jadi menambah
 * backend baru TIDAK mengubah manajer.
 */

let _pty;
function lib() {
    if (_pty === undefined) {
        try { _pty = require("node-pty"); }
        catch { _pty = null; }
    }
    return _pty;
}

module.exports = {

    id: "local",

    get available() {
        return lib() !== null;
    },

    /** @returns handle mirip-pty (node-pty IPty). */
    spawn({ shellPath, args = [], cwd, cols = 120, rows = 30, env = {} }) {
        const pty = lib();
        if (!pty) throw new Error("node-pty belum diinstall (npm install node-pty).");
        const opts = {
            name: "xterm-256color",
            cols, rows, cwd,
            env: { ...env, TERM: "xterm-256color" }
        };
        // Windows: pakai winpty (bukan ConPTY). ConPTY menjalankan
        // helper "conpty_console_list_agent" saat kill yang gagal
        // ("AttachConsole failed") ketika daemon headless → spam stderr.
        if (process.platform === "win32") opts.useConpty = false;
        return pty.spawn(shellPath, args, opts);
    }

};
