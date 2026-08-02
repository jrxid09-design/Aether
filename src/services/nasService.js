const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const pexec = promisify(execFile);
const OPTS = { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 };

/**
 * nasService — status penyimpanan & host untuk view NAS.
 *
 * Semua data NYATA dari mesin (dev laptop / PC rumah), tanpa angka
 * karangan. Tiap sumber best-effort: kalau tool tak ada (smartctl,
 * docker), bagian itu ditandai unavailable — bukan diisi data palsu.
 */

async function volumes() {
    if (process.platform === "win32") {
        try {
            const { stdout } = await pexec("powershell", [
                "-NoProfile", "-NonInteractive", "-Command",
                "Get-Volume | Where-Object { $_.DriveLetter } | " +
                "Select-Object DriveLetter,FileSystemLabel,FileSystem,Size,SizeRemaining | ConvertTo-Json -Compress"
            ], OPTS);
            let arr = JSON.parse(stdout || "[]");
            if (!Array.isArray(arr)) arr = [arr];
            return arr.map(v => {
                const total = Number(v.Size) || 0;
                const free = Number(v.SizeRemaining) || 0;
                const used = Math.max(0, total - free);
                return {
                    mount: `${v.DriveLetter}:`, label: v.FileSystemLabel || null,
                    fs: v.FileSystem || null, total, free, used,
                    usedPercent: total ? Math.round(used / total * 100) : 0
                };
            });
        }
        catch { return []; }
    }
    // POSIX
    try {
        const { stdout } = await pexec("df", ["-kP"], OPTS);
        return stdout.trim().split("\n").slice(1).map(line => {
            const p = line.split(/\s+/);
            const total = Number(p[1]) * 1024, used = Number(p[2]) * 1024, free = Number(p[3]) * 1024;
            return { mount: p[5], label: p[0], fs: null, total, used, free, usedPercent: total ? Math.round(used / total * 100) : 0 };
        }).filter(v => v.total > 0);
    }
    catch { return []; }
}

async function smart() {
    try {
        const scan = await pexec("smartctl", ["--scan", "-j"], OPTS);
        const devices = JSON.parse(scan.stdout).devices || [];
        const out = [];
        for (const d of devices) {
            try {
                const r = await pexec("smartctl", ["-Hij", d.name], OPTS);
                const j = JSON.parse(r.stdout);
                out.push({
                    device: d.name,
                    model: j.model_name ?? null,
                    health: j.smart_status?.passed === true ? "PASSED" : (j.smart_status ? "FAILED" : "?"),
                    tempC: j.temperature?.current ?? null,
                    capacity: j.user_capacity?.bytes ?? null
                });
            }
            catch { /* satu disk gagal — lewati */ }
        }
        return { available: true, devices: out };
    }
    catch {
        return { available: false, devices: [], reason: "smartctl tidak ditemukan (install smartmontools untuk data SMART)." };
    }
}

async function docker() {
    try {
        const { stdout } = await pexec("docker", ["ps", "--format", "{{json .}}"], OPTS);
        const containers = stdout.trim().split("\n").filter(Boolean).map(l => {
            const c = JSON.parse(l);
            return { name: c.Names, image: c.Image, status: c.Status, state: c.State ?? null };
        });
        return { available: true, containers };
    }
    catch {
        return { available: false, containers: [], reason: "docker tidak tersedia." };
    }
}

function network() {
    const out = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
            if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address, mac: a.mac });
        }
    }
    return out;
}

class NasService {
    async status() {
        const [vols, sm, dk] = await Promise.all([volumes(), smart(), docker()]);
        return {
            host: os.hostname(),
            platform: `${os.platform()} ${os.release()}`,
            volumes: vols,
            smart: sm,
            docker: dk,
            network: network(),
            at: new Date().toISOString()
        };
    }
}

module.exports = new NasService();
