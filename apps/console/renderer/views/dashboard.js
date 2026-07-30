import { store } from "../lib/store.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import {
    esc, bytes, duration, relativeTime,
    pill, gauge, sparkline, toast
} from "../lib/ui.js";

export const dashboard = {

    id: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    title: "Dashboard",
    subtitle: "Kesiapan seluruh sistem Aether dalam satu layar.",

    render(root) {

        const state = store.get();

        if (!state.connected || !state.overview) {

            root.innerHTML = head() + disconnected(state);

            return;

        }

        const o = state.overview;

        root.innerHTML = head() + `
            <div class="stack">
                ${readinessRow(o)}
                ${resourceRow(o, state.history)}
                <div class="grid cols-2">
                    ${aiPanel(o)}
                    ${activityPanel(state.logs)}
                </div>
            </div>
        `;

    },

    mount(root) {

        root.querySelector("#refresh-overview")
            ?.addEventListener("click", async () => {

                try {
                    await api.checkIntegrations();
                    toast("Integrasi diperiksa ulang", "ok");
                }
                catch (error) {
                    toast(error.message, "danger");
                }

            });

    }

};

function head() {

    return `
        <div class="view-head">
            <div>
                <h1>Dashboard</h1>
                <p>Kesiapan seluruh sistem Aether dalam satu layar.</p>
            </div>
            <div class="actions">
                <button class="btn ghost sm" id="refresh-overview">
                    ${icon("refresh")} Periksa ulang
                </button>
            </div>
        </div>`;

}

function disconnected(state) {

    return `
        <div class="panel">
            <div class="empty">
                ${icon("plug", "icon")}
                <div style="font-size:14px;color:var(--text)">
                    ${state.connecting ? "Menghubungkan ke daemon…" : "Belum terhubung ke daemon Aether"}
                </div>
                <div>
                    ${state.lastError
                        ? esc(state.lastError)
                        : "Jalankan daemon lalu tekan Hubungkan di titlebar, atau atur alamatnya di Settings."}
                </div>
            </div>
        </div>`;

}

/** Baris kartu kesiapan — pertanyaan pertama yang selalu ditanyakan. */
function readinessRow(o) {

    const byId = Object.fromEntries(
        o.integrations.items.map(item => [item.id, item])
    );

    const cards = [

        daemonCard(o),

        integrationCard(byId.ollama, "Ollama", "cpu", item => {

            const detail = item?.status?.detail ?? {};

            if (!item?.status?.online) {
                return "AI lokal tidak terjangkau";
            }

            return `${detail.modelCount ?? 0} model · ${detail.loadedCount ?? 0} dimuat`;

        }),

        integrationCard(byId.openclaw, "OpenClaw", "link", item =>
            item?.status?.online
                ? `health: ${item.status.detail?.healthPath ?? "?"}`
                : "Gateway tidak terjangkau"
        ),

        integrationCard(byId.hermes, "Hermes Agent", "activity", item =>
            item?.status?.online
                ? `health: ${item.status.detail?.healthPath ?? "?"}`
                : "Agent tidak terjangkau"
        ),

        deviceCard("Mikrofon", "mic", o.devices.audio),

        deviceCard("Kamera", "camera", o.devices.video),

        sensorCard(o.devices.sensors),

        toolsCard(o)

    ];

    return `<div class="grid cols-4">${cards.join("")}</div>`;

}

function daemonCard(o) {

    return `
        <div class="stat">
            <div class="label">${icon("server")} Daemon</div>
            <div class="value">v${esc(o.daemon.version)}</div>
            <div class="row" style="gap:8px">
                ${pill("Online", "ok")}
                <span class="meta">${esc(o.daemon.environment)} · :${esc(o.daemon.port)}</span>
            </div>
            <div class="meta">aktif ${duration(o.stats.daemon.uptime)}</div>
        </div>`;

}

function integrationCard(item, label, iconName, describe) {

    const online = item?.status?.online === true;

    const disabled = item?.enabled === false;

    const tone = disabled ? "idle" : (online ? "ok" : "danger");

    const text = disabled ? "Nonaktif" : (online ? "Siap" : "Mati");

    const latency = item?.status?.latency;

    return `
        <div class="stat">
            <div class="label">${icon(iconName)} ${esc(label)}</div>
            <div class="value" style="font-size:17px">
                ${pill(text, tone)}
            </div>
            <div class="meta">${esc(describe(item))}</div>
            <div class="meta dim">
                ${item?.baseUrl ? esc(item.baseUrl.replace(/^https?:\/\//, "")) : "—"}
                ${latency != null && online ? ` · ${latency}ms` : ""}
            </div>
        </div>`;

}

function deviceCard(label, iconName, info) {

    const tone = info.enabled ? "ok" : (info.configured ? "warn" : "idle");

    const text = info.enabled ? "Aktif" : (info.configured ? "Terpilih" : "Belum diatur");

    return `
        <div class="stat">
            <div class="label">${icon(iconName)} ${esc(label)}</div>
            <div class="value" style="font-size:17px">${pill(text, tone)}</div>
            <div class="meta">${info.label ? esc(info.label) : "belum ada perangkat dipilih"}</div>
            <div class="meta dim">atur di tab Devices</div>
        </div>`;

}

function sensorCard(sensors) {

    return `
        <div class="stat">
            <div class="label">${icon("sensor")} Sensor</div>
            <div class="value">${sensors.enabled}<span class="unit">/ ${sensors.total}</span></div>
            <div class="meta">${sensors.total ? "aktif dari terdaftar" : "belum ada sensor"}</div>
            <div class="meta dim">endpoint HTTP</div>
        </div>`;

}

function toolsCard(o) {

    return `
        <div class="stat">
            <div class="label">${icon("tool")} Plugin &amp; Tool</div>
            <div class="value">${o.tools.total}<span class="unit">tool</span></div>
            <div class="meta">${o.plugins.total} plugin ter-load</div>
            <div class="meta dim">tersedia untuk model</div>
        </div>`;

}

/** Baris sumber daya host — penting karena AI lokal berat di RAM. */
function resourceRow(o, history) {

    const memory = o.stats.memory;

    const host = o.stats.host;

    return `
        <div class="grid cols-3">

            <div class="panel">
                <div class="panel-head">
                    <h2>Prosesor</h2>
                    <span class="hint push">${esc(host.cpuCount)} core</span>
                </div>
                <div class="row" style="gap:16px">
                    ${gauge(o.stats.cpu.usage, "Pemakaian CPU")}
                    <div style="flex:1;min-width:0">
                        <div class="small muted truncate" title="${esc(host.cpuModel)}">${esc(host.cpuModel)}</div>
                        ${sparkline(history.cpu)}
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-head">
                    <h2>Memori</h2>
                    <span class="hint push">${bytes(memory.total)}</span>
                </div>
                <div class="row" style="gap:16px">
                    ${gauge(memory.usedPercent, "Pemakaian RAM")}
                    <div style="flex:1;min-width:0">
                        <div class="small muted">${bytes(memory.used)} terpakai · ${bytes(memory.free)} bebas</div>
                        ${sparkline(history.memory, { stroke: "var(--accent-3)" })}
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-head"><h2>Host</h2></div>
                <div class="stack" style="gap:9px">
                    ${infoRow("Nama", host.hostname)}
                    ${infoRow("Sistem", `${host.platform} ${host.release}`)}
                    ${infoRow("Arsitektur", host.arch)}
                    ${infoRow("Node", o.stats.process.nodeVersion)}
                    ${infoRow("Uptime host", duration(host.uptime))}
                    ${infoRow("Memori proses", bytes(o.stats.process.rss))}
                </div>
            </div>

        </div>`;

}

function infoRow(label, value) {

    return `<div class="row">
        <span class="small dim">${esc(label)}</span>
        <span class="small mono push truncate" style="max-width:60%">${esc(value)}</span>
    </div>`;

}

function aiPanel(o) {

    const metrics = o.ai.metrics ?? {};

    const providers = o.ai.providers ?? [];

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>AI Runtime</h2>
                <span class="hint push">aktif: <span class="mono">${esc(o.ai.active ?? "—")}</span></span>
            </div>

            <div class="stack" style="gap:8px">
                ${providers.map(provider => `
                    <div class="row">
                        ${pill(provider.online ? "online" : "offline", provider.online ? "ok" : "danger")}
                        <span class="small mono">${esc(provider.id)}</span>
                        <span class="small dim push">
                            ${provider.latency != null ? `${provider.latency}ms` : esc(provider.error ?? "")}
                        </span>
                    </div>
                `).join("") || `<div class="small dim">Tidak ada provider terdaftar.</div>`}
            </div>

            <div class="divider"></div>

            <div class="grid cols-2" style="gap:10px">
                ${infoRow("Model default", o.ai.defaultModel ?? "—")}
                ${infoRow("Total request", metrics.requests ?? 0)}
                ${infoRow("Berhasil", metrics.success ?? 0)}
                ${infoRow("Gagal", metrics.failed ?? 0)}
                ${infoRow("Rata-rata", `${Math.round(metrics.averageDuration ?? 0)} ms`)}
                ${infoRow("Total token", metrics.totalTokens ?? 0)}
            </div>
        </div>`;

}

function activityPanel(logs) {

    const recent = logs.slice(-9).reverse();

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>Aktivitas Terakhir</h2>
                <span class="hint push">${logs.length} entri</span>
            </div>

            ${recent.length === 0
                ? `<div class="empty">${icon("activity")}<div>Belum ada aktivitas.</div></div>`
                : `<div class="stack" style="gap:7px">
                    ${recent.map(entry => `
                        <div class="row" style="align-items:flex-start;gap:9px">
                            <span class="pill ${toneOf(entry.level)}" style="padding:1px 7px;font-size:9.5px">
                                ${esc((entry.level ?? "info").toUpperCase())}
                            </span>
                            <span class="small truncate" style="flex:1" title="${esc(entry.message)}">
                                ${esc(entry.message)}
                            </span>
                            <span class="small dim mono">${relativeTime(entry.time)}</span>
                        </div>
                    `).join("")}
                </div>`}
        </div>`;

}

function toneOf(level) {

    if (level === "error") return "danger";
    if (level === "warn") return "warn";
    if (level === "event") return "idle";

    return "ok";

}
