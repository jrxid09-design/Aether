import { store } from "../lib/store.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, bytes, duration, relativeTime, gauge, sparkline, toast } from "../lib/ui.js";

/**
 * Dashboard — "Mission Control" Aether.
 *
 * Satu layar yang menjawab dalam 3 detik: apakah sistem sehat, apa yang
 * sedang dikerjakan AI, apa yang menunggu keputusanku, dan bagaimana
 * kondisi rumah. Bagian inti digambar dari overview (sinkron); panel
 * yang butuh data lain (agents/usulan/rumah/CCTV) diisi saat mount
 * dengan degradasi anggun bila sumbernya belum ada.
 */

let clockTimer = null;

export const dashboard = {

    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    title: "Mission Control",
    subtitle: "Kendali seluruh sistem Aether dalam satu layar.",

    render(root) {

        const state = store.get();

        if (!state.connected || !state.overview) {
            root.innerHTML = disconnected(state);
            return;
        }

        const o = state.overview;

        root.innerHTML = `
            <div class="stack">

                <div class="mc-top">
                    <div class="panel greet">
                        <span class="hello">${greeting()},</span>
                        <h1>Selamat datang<span class="dot">.</span></h1>
                        <p>Aether siap membantumu mengelola sistem, data, agent, dan rumah.</p>
                    </div>
                    ${healthHero(o)}
                    <div class="panel mc-clock">
                        <div class="time" id="mc-time">--:--</div>
                        <div class="date" id="mc-date"></div>
                    </div>
                </div>

                ${metricsRow(o, state.history)}

                <div class="grid cols-2">
                    <div class="panel">
                        <div class="panel-head"><h2>${icon("activity")} Aliran Aktivitas AI</h2>
                            <span class="hint push">langsung</span></div>
                        <div id="mc-flow">${flow(state.logs)}</div>
                    </div>
                    <div class="stack">
                        <div class="panel">
                            <div class="panel-head"><h2>${icon("server")} Status Sistem</h2>
                                <span class="hint push">${o.integrations.summary.online}/${o.integrations.summary.enabled} online</span></div>
                            ${systemStatus(o)}
                        </div>
                        <div class="panel">
                            <div class="panel-head"><h2>${icon("activity")} Agents</h2>
                                <span class="hint push" id="mc-agents-count">—</span></div>
                            <div id="mc-agents"><div class="empty">${icon("activity")}<div>Memuat…</div></div></div>
                        </div>
                    </div>
                </div>

                <div class="grid cols-2">
                    <div class="panel">
                        <div class="panel-head"><h2>${icon("memory")} Usulan Memori</h2>
                            <span class="hint push" id="mc-prop-count">—</span></div>
                        <div id="mc-proposals"><div class="empty">${icon("memory")}<div>Memuat…</div></div></div>
                    </div>
                    <div class="panel">
                        <div class="panel-head"><h2>${icon("activity")} Notifikasi</h2>
                            <span class="hint push">${state.logs.length} entri</span></div>
                        ${notifications(state.logs)}
                    </div>
                </div>

                <div class="grid cols-2">
                    <div class="panel">
                        <div class="panel-head"><h2>${icon("cpu")} Monitor Sumber Daya</h2>
                            <span class="hint push">${esc(o.stats.host.cpuCount)} core · ${bytes(o.stats.memory.total)}</span></div>
                        ${resourceMonitor(o, state.history)}
                    </div>
                    <div class="panel">
                        <div class="panel-head"><h2>${icon("home")} Smart Home</h2>
                            <span class="hint push" id="mc-home-count">—</span></div>
                        <div id="mc-home"><div class="empty">${icon("home")}<div>Memuat…</div></div></div>
                    </div>
                </div>

                <div class="panel">
                    <div class="panel-head"><h2>${icon("camera")} CCTV</h2>
                        <span class="hint push" id="mc-cctv-count">—</span></div>
                    <div id="mc-cctv" class="cctv-grid">${cctvSkeleton()}</div>
                </div>

            </div>`;
    },

    mount(root) {

        tickClock(root);
        clearInterval(clockTimer);
        clockTimer = setInterval(() => tickClock(root), 1000);

        if (!store.get().connected) return;

        enrichAgents(root);
        enrichProposals(root);
        enrichHome(root);
        enrichCctv(root);
    },

    unmount() {
        clearInterval(clockTimer);
        clockTimer = null;
    }

};

// ---- Bagian sinkron (dari overview) ---------------------------------

function greeting() {
    const h = new Date().getHours();
    if (h < 11) return "Selamat pagi";
    if (h < 15) return "Selamat siang";
    if (h < 18) return "Selamat sore";
    return "Selamat malam";
}

function tickClock(root) {
    const now = new Date();
    const t = root.querySelector("#mc-time");
    const d = root.querySelector("#mc-date");
    if (t) t.textContent = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (d) d.textContent = now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function healthHero(o) {
    const s = o.integrations.summary;
    const allUp = s.enabled > 0 && s.online >= s.enabled;
    const tone = allUp ? "ok" : (s.online > 0 ? "warn" : "danger");
    const verdict = allUp ? "HEALTHY" : (s.online > 0 ? "DEGRADED" : "OFFLINE");
    const sub = allUp ? "Semua sistem berjalan normal"
        : (s.online > 0 ? "Sebagian layanan bermasalah" : "Layanan inti tak terjangkau");
    return `
        <div class="panel hero-health" data-tone="${tone}">
            <div class="shield">${icon("check")}</div>
            <div>
                <div class="verdict">${verdict}</div>
                <div class="sub">${esc(sub)}</div>
            </div>
        </div>`;
}

function metric(iconName, label, value, unit, sub, spark) {
    return `
        <div class="metric">
            <div class="k">${icon(iconName)} ${esc(label)}</div>
            <div class="v">${esc(value)}${unit ? `<span class="u">${esc(unit)}</span>` : ""}</div>
            ${spark ?? (sub ? `<div class="s">${esc(sub)}</div>` : "")}
        </div>`;
}

function metricsRow(o, history) {
    const mem = o.stats.memory;
    const m = o.ai.metrics ?? {};
    return `<div class="metrics">
        ${metric("cpu", "CPU", Math.round(o.stats.cpu.usage), "%", null, sparkline(history.cpu, { height: 26 }))}
        ${metric("cpu", "RAM", Math.round(mem.usedPercent), "%", null, sparkline(history.memory, { height: 26, stroke: "var(--accent-3)" }))}
        ${metric("server", "Uptime", duration(o.stats.daemon.uptime), "", "daemon aktif")}
        ${metric("activity", "AI Request", m.requests ?? 0, "", `${m.failed ?? 0} gagal`)}
        ${metric("cpu", "Model", shortModel(o.ai.active ?? o.ai.defaultModel), "", "aktif")}
        ${metric("tool", "Tools", o.tools.total, "", `${o.plugins.total} plugin`)}
    </div>`;
}

function shortModel(name) {
    if (!name) return "—";
    const s = String(name).split("/").pop();
    return s.length > 14 ? s.slice(0, 13) + "…" : s;
}

function systemStatus(o) {
    const rows = [
        { name: "Aether Core", on: true },
        { name: "Memory Engine", on: true }
    ];
    for (const it of o.integrations.items) {
        if (it.enabled === false) continue;
        rows.push({ name: it.label ?? it.id, on: it.status?.online === true });
    }
    return `<div class="status-list">
        ${rows.map(r => `<div class="s ${r.on ? "on" : "off"}">
            <span class="d"></span><span>${esc(r.name)}</span>
            <span class="st">${r.on ? "Online" : "Offline"}</span>
        </div>`).join("")}
    </div>`;
}

const FLOW_ICON = { error: "x", warn: "activity", event: "link", info: "check" };
const FLOW_TONE = { error: "warn", warn: "warn", event: "acc", info: "ok" };

function flow(logs) {
    const recent = logs.slice(-8).reverse();
    if (!recent.length) return `<div class="empty">${icon("activity")}<div>Belum ada aktivitas.</div></div>`;
    return `<div class="flow">${recent.map(e => {
        const lvl = e.level ?? "info";
        return `<div class="step" data-tone="${FLOW_TONE[lvl] ?? "ok"}">
            <span class="node">${icon(FLOW_ICON[lvl] ?? "check")}</span>
            <div><div class="lbl">${esc(e.message)}</div></div>
            <span class="tm">${relativeTime(e.time)}</span>
        </div>`;
    }).join("")}</div>`;
}

function notifications(logs) {
    const notes = logs.filter(e => ["warn", "error", "event"].includes(e.level)).slice(-6).reverse();
    if (!notes.length) return `<div class="empty">${icon("activity")}<div>Tak ada notifikasi.</div></div>`;
    return `<div class="stack" style="gap:9px">${notes.map(e => `
        <div class="row" style="align-items:flex-start;gap:9px">
            <span class="proposal ic" style="width:26px;height:26px;background:${e.level === "error" ? "var(--danger-dim)" : e.level === "warn" ? "var(--warn-dim)" : "var(--idle-dim)"}">
                ${icon(e.level === "error" ? "x" : "activity")}</span>
            <span class="small truncate" style="flex:1" title="${esc(e.message)}">${esc(e.message)}</span>
            <span class="small dim mono">${relativeTime(e.time)}</span>
        </div>`).join("")}</div>`;
}

function resourceMonitor(o, history) {
    const mem = o.stats.memory;
    return `
        <div class="row" style="gap:18px;align-items:center">
            ${gauge(o.stats.cpu.usage, "CPU")}
            ${gauge(mem.usedPercent, "RAM")}
            <div style="flex:1;min-width:0">
                <div class="small muted truncate" title="${esc(o.stats.host.cpuModel)}">${esc(o.stats.host.cpuModel)}</div>
                ${sparkline(history.cpu)}
                <div class="small dim">${bytes(mem.used)} / ${bytes(mem.total)} · proses ${bytes(o.stats.process.rss)}</div>
            </div>
        </div>`;
}

function cctvSkeleton() {
    return Array.from({ length: 4 }, () => `<div class="cctv-cell"><span class="ph">${icon("camera")}</span></div>`).join("");
}

function disconnected(state) {
    return `
        <div class="panel">
            <div class="empty">
                ${icon("plug")}
                <div style="font-size:14px;color:var(--text)">
                    ${state.connecting ? "Menghubungkan ke daemon…" : "Belum terhubung ke daemon Aether"}
                </div>
                <div>${state.lastError ? esc(state.lastError) : "Jalankan daemon lalu tekan Hubungkan di titlebar."}</div>
            </div>
        </div>`;
}

// ---- Bagian async (diisi saat mount) --------------------------------

async function enrichAgents(root) {
    const host = root.querySelector("#mc-agents");
    try {
        const r = await api.agents();
        const list = r.agents ?? r.items ?? (Array.isArray(r) ? r : []);
        root.querySelector("#mc-agents-count").textContent = `${list.length} agent`;
        host.innerHTML = list.length === 0
            ? `<div class="empty">${icon("activity")}<div>Belum ada agent.</div></div>`
            : list.map(a => {
                const name = a.name ?? a.label ?? a.id ?? "Agent";
                const online = a.online ?? (a.status && a.status !== "offline");
                const status = a.status ?? (online ? "online" : "offline");
                return `<div class="agentrow">
                    <span class="tile">${icon("activity")}</span>
                    <div><div class="nm">${esc(name)}</div><div class="rl">${esc(a.role ?? a.kind ?? "agent")}</div></div>
                    <div class="rt">
                        <span class="pill ${online ? "ok" : "idle"}"><span class="dot"></span>${esc(status)}</span>
                        ${a.latency != null ? `<div class="lat">${esc(a.latency)}ms</div>` : ""}
                    </div>
                </div>`;
            }).join("");
    }
    catch {
        host.innerHTML = `<div class="empty">${icon("activity")}<div>Agents tak tersedia.</div></div>`;
        root.querySelector("#mc-agents-count").textContent = "—";
    }
}

async function enrichProposals(root) {
    const host = root.querySelector("#mc-proposals");
    try {
        const r = await api.memoryProposals();
        const items = r.items ?? [];
        root.querySelector("#mc-prop-count").textContent = `${items.length} menunggu`;
        if (!items.length) {
            host.innerHTML = `<div class="empty">${icon("check")}<div>Tak ada usulan menunggu.</div></div>`;
            return;
        }
        host.innerHTML = items.slice(0, 5).map(p => `
            <div class="proposal" data-id="${esc(p.id)}">
                <span class="ic">${icon("memory")}</span>
                <div>
                    <div class="ttl">${esc(p.memoryType ?? p.kind ?? "memori")}</div>
                    <div class="desc">${esc(p.payload?.content ?? "—")}</div>
                    <div class="acts">
                        <button class="btn primary sm" data-approve>${icon("check")} Setujui</button>
                        <button class="btn ghost sm" data-reject>${icon("x")} Tolak</button>
                    </div>
                </div>
            </div>`).join("");
        host.querySelectorAll(".proposal").forEach(node => {
            const id = node.dataset.id;
            node.querySelector("[data-approve]").addEventListener("click", async () => {
                try { await api.approveProposal(id); toast("Usulan disetujui", "ok"); enrichProposals(root); }
                catch (e) { toast(e.message, "danger"); }
            });
            node.querySelector("[data-reject]").addEventListener("click", async () => {
                try { await api.rejectProposal(id); toast("Usulan ditolak", "ok"); enrichProposals(root); }
                catch (e) { toast(e.message, "danger"); }
            });
        });
    }
    catch {
        host.innerHTML = `<div class="empty">${icon("memory")}<div>Usulan tak tersedia.</div></div>`;
        root.querySelector("#mc-prop-count").textContent = "—";
    }
}

async function enrichHome(root) {
    const host = root.querySelector("#mc-home");
    try {
        const r = await api.homeDevices();
        const devices = r.devices ?? r.items ?? (Array.isArray(r) ? r : []);
        root.querySelector("#mc-home-count").textContent = `${devices.length} perangkat`;
        if (!devices.length) {
            host.innerHTML = `<div class="empty">${icon("home")}<div>Home Assistant belum terhubung.</div></div>`;
            return;
        }
        host.innerHTML = `<div class="grid cols-2" style="gap:10px">${devices.slice(0, 6).map(d => {
            const name = d.name ?? d.friendlyName ?? d.entityId ?? "Perangkat";
            const on = d.state === "on" || d.on === true;
            return `<div class="stat" style="padding:11px 13px">
                <div class="label">${icon("home")} ${esc(name)}</div>
                <div class="value" style="font-size:15px">${esc(d.state ?? (on ? "ON" : "—"))}</div>
            </div>`;
        }).join("")}</div>`;
    }
    catch {
        host.innerHTML = `<div class="empty">${icon("home")}<div>Home Assistant belum terhubung.</div></div>`;
        root.querySelector("#mc-home-count").textContent = "—";
    }
}

async function enrichCctv(root) {
    const host = root.querySelector("#mc-cctv");
    try {
        const r = await api.cameras();
        const cams = r.cameras ?? r.items ?? (Array.isArray(r) ? r : []);
        root.querySelector("#mc-cctv-count").textContent = `${cams.length} kamera`;
        if (!cams.length) return;   // biarkan skeleton
        host.innerHTML = cams.slice(0, 8).map(c => {
            const name = c.name ?? c.label ?? c.id ?? "Kamera";
            const online = c.online ?? true;
            return `<div class="cctv-cell">
                <span class="ph">${icon("camera")}</span>
                <span class="liv ${online ? "" : "motion"}"></span>
                <span class="cap">${esc(name)}</span>
            </div>`;
        }).join("");
    }
    catch {
        root.querySelector("#mc-cctv-count").textContent = "—";
    }
}
