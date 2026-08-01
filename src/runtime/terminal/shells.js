const fs = require("node:fs");

/**
 * Registry shell lintas-OS untuk Terminal Runtime.
 *
 * Hanya mendeteksi & menormalkan shell — TIDAK menyentuh node-pty,
 * jadi aman di-require kapan pun. TerminalRuntime yang memilih shell
 * lewat resolve().
 */

const WIN = process.platform === "win32";

const exists = p => { try { return Boolean(p) && fs.existsSync(p); } catch { return false; } };

/** Daftar shell yang tersedia di mesin ini. */
function detect() {

    if (!WIN) {
        return [
            { id: "bash", name: "bash", path: process.env.SHELL || "/bin/bash", args: [] }
        ].filter(s => exists(s.path));
    }

    const sys = process.env.SystemRoot || "C:\\Windows";
    const candidates = [
        { id: "powershell", name: "PowerShell", path: `${sys}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`, args: ["-NoLogo"] },
        { id: "pwsh", name: "PowerShell 7", path: `${process.env.ProgramFiles}\\PowerShell\\7\\pwsh.exe`, args: ["-NoLogo"] },
        { id: "cmd", name: "Command Prompt", path: `${sys}\\System32\\cmd.exe`, args: [] },
        { id: "wsl", name: "WSL", path: `${sys}\\System32\\wsl.exe`, args: [] },
        { id: "gitbash", name: "Git Bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["-i", "-l"] },
        { id: "gitbash", name: "Git Bash", path: "C:\\Program Files (x86)\\Git\\bin\\bash.exe", args: ["-i", "-l"] }
    ];

    const out = [];
    const seen = new Set();
    for (const s of candidates) {
        if (seen.has(s.id) || !exists(s.path)) continue;
        seen.add(s.id);
        out.push(s);
    }
    return out;
}

/** Shell default (PowerShell di Windows, bash di lainnya) — atau apa pun yang ada. */
function resolve(shellId) {
    const all = detect();
    if (shellId) {
        const hit = all.find(s => s.id === shellId);
        if (hit) return hit;
    }
    return all[0] || (WIN
        ? { id: "cmd", name: "Command Prompt", path: "cmd.exe", args: [] }
        : { id: "bash", name: "bash", path: "/bin/bash", args: [] });
}

module.exports = { detect, resolve, isWindows: WIN };
