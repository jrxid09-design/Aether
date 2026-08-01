const path = require("node:path");

const JsonStore = require("../core/config/JsonStore");
const telemetry = require("../services/telemetryService");
const terminals = require("./terminal/TerminalRuntime");

/**
 * Runtime API — status terpadu semua runtime inti Aether untuk Runtime
 * Console (Hermes/OpenClaw/Docker/Ollama/Aether). Sumber:
 *   - kesehatan: agentHub / integrations (REST/health)
 *   - proses (pid/uptime/cpu/mem): terminal yang terikat by PURPOSE
 *   - Aether: proses daemon itu sendiri
 *
 * "Business state" tetap dari REST (bukan WS). Panel masa depan
 * (Logs/Metrics/Inspector) memakai ulang API ini.
 */

// Perintah start bisa di-override di configs/runtimes.json (per-mesin).
const store = new JsonStore(
    path.join(__dirname, "..", "..", "configs", "runtimes.json"),
    { overrides: {} }
);

const RUNTIMES = [
    { key: "aether", label: "Aether", purpose: "aether", owner: "system", self: true, restartPolicy: "managed" },
    { key: "hermes", label: "Hermes", purpose: "hermes", owner: "system", integrationId: "hermes", command: "hermes serve", expect: "listening|ready|started", restartPolicy: "on-failure" },
    { key: "openclaw", label: "OpenClaw", purpose: "openclaw", owner: "system", integrationId: "openclaw", command: "openclaw serve", expect: "listening|ready|started", restartPolicy: "on-failure" },
    { key: "ollama", label: "Ollama", purpose: "ollama", owner: "system", integrationId: "ollama", command: "ollama serve", expect: "listening|Listening", restartPolicy: "on-failure" },
    { key: "docker", label: "Docker", purpose: "docker", owner: "system", command: null, restartPolicy: "never" }
];

let _pidusage;
function pidusageLib() {
    if (_pidusage === undefined) {
        try { _pidusage = require("pidusage"); }
        catch { _pidusage = null; }
    }
    return _pidusage;
}

async function metrics(pid) {
    const lib = pidusageLib();
    if (!lib || !pid) return { cpu: null, memory: null };
    try {
        const s = await lib(pid);
        return { cpu: Math.round(s.cpu), memory: Math.round(s.memory / 1048576) }; // %, MB
    }
    catch { return { cpu: null, memory: null }; }
}

/** Peta kesehatan by id dari agentHub (+ integrations bila ada). */
async function healthMap() {
    const map = {};
    try {
        const agentHub = require("../services/agentHub");
        for (const a of await agentHub.health()) map[a.id] = a.online === true;
    }
    catch { /* opsional */ }
    try {
        const { manager } = require("../integrations");
        const o = manager.get?.("ollama");
        if (o) map.ollama = o.lastStatus?.online === true;
    }
    catch { /* opsional */ }
    return map;
}

function cfg(key, field, fallback) {
    return store.read().overrides?.[key]?.[field] ?? fallback;
}

async function status() {
    const health = await healthMap();
    const out = [];

    for (const r of RUNTIMES) {
        const term = terminals.findByPurpose(r.purpose);
        const tmeta = term ? term.meta() : null;

        let pid = null, uptime = null, running = false, restartPolicy = r.restartPolicy, hp = "unknown";

        if (r.self) {
            pid = process.pid;
            uptime = Math.round(process.uptime());
            running = true;
            hp = "online";
        }
        else {
            if (tmeta) {
                pid = tmeta.pid;
                running = tmeta.status === "running";
                restartPolicy = tmeta.restartPolicy;
                uptime = Math.round((Date.now() - new Date(tmeta.startedAt).getTime()) / 1000);
            }
            hp = (r.integrationId && health[r.integrationId] !== undefined)
                ? (health[r.integrationId] ? "online" : "offline")
                : (running ? "online" : "offline");
        }

        let met;
        if (r.self) {
            met = await metrics(pid);
            if (met.memory == null) met.memory = Math.round(process.memoryUsage().rss / 1048576);
        }
        else {
            met = await metrics(pid);
        }

        out.push({
            key: r.key, label: r.label, purpose: r.purpose, owner: r.owner,
            status: running ? "running" : "stopped",
            health: hp,
            pid, uptime,
            restartPolicy,
            cpu: met.cpu, memory: met.memory,
            terminalId: tmeta?.id ?? null,
            canRestart: Boolean(!r.self && (cfg(r.key, "command", r.command)))
        });
    }

    return out;
}

/** Restart runtime lewat terminal bernama (by purpose) — reuse Component 1-3. */
async function restart(key) {
    const r = RUNTIMES.find(x => x.key === key);
    if (!r) throw new Error(`Runtime tak dikenal: ${key}`);
    if (r.self) throw new Error("Aether tidak bisa direstart dari sini.");

    const command = cfg(key, "command", r.command);
    if (!command) throw new Error(`Belum ada perintah start untuk ${r.label} (atur di configs/runtimes.json).`);
    const expect = cfg(key, "expect", r.expect);

    const existing = terminals.findByPurpose(r.purpose);
    let id;
    if (existing) {
        id = existing.id;
        terminals.signal(id, "SIGINT");
        await new Promise(res => setTimeout(res, 800));
    }
    else {
        id = terminals.ensureByPurpose({
            purpose: r.purpose, name: r.label, terminalType: "SYSTEM",
            owner: "system", createdBy: "system", restartPolicy: r.restartPolicy
        }).id;
    }

    const res = await terminals.execute(id, command, { expect, timeoutMs: 30000 });
    telemetry.publish("runtime:restarted", { key, terminal: id, ready: res.matched });
    return { runtime: key, terminal: id, ready: res.matched };
}

module.exports = { status, restart, RUNTIMES };
