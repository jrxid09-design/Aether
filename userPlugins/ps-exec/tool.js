// Dibuat oleh Aether ToolForge.
// Aman diedit tangan; ubah lalu muat ulang dari Console.

class PsExecTool {

    constructor() {
        this.name = "psExec";
        this.description = "Menjalankan perintah PowerShell/shell di mesin ini dan mengembalikan output + exit code. Untuk spawn process, kill, cek status proses, dan membaca file.";
        this.parameters = {
                "command": {
                        "description": "Perintah PowerShell",
                        "required": true,
                        "type": "string"
                },
                "timeout_ms": {
                        "description": "Timeout milidetik",
                        "type": "number"
                }
        };
    }

    async execute(context, args = {}) {
        const { spawn } = require('child_process');
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'powershell.exe' : '/bin/sh';
        const full = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];
        const child = spawn(cmd, full, { windowsHide: true });
        let out = '', err = '';
        child.stdout.on('data', d => out += d);
        child.stderr.on('data', d => g++ && (err += d));
        let g = 0;
        child.stderr.on('data', d => { err += d; });
        child.stdout.on('data', d => { out += d; });
        const t = Number(timeout_ms || 30000);
        const timer = setTimeout(() => { try { child.kill(); } catch(e){} }, t);
        await new Promise(resolve => child.on('close', code => { clearTimeout(timer); resolve(code); }));
        return { ok: true, stdout: out.slice(0, 8000), stderr: err.slice(0, 8000) };
    }

}

module.exports = [ new PsExecTool() ];
