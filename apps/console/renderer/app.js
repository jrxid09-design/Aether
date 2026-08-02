import { store } from "./lib/store.js";
import { api } from "./lib/api.js";
import { icon, brandMark } from "./lib/icons.js";
import { $, esc, pill, toast } from "./lib/ui.js";
import { openCommandPalette } from "./lib/commandPalette.js";

import { dashboard } from "./views/dashboard.js";
import { awareness } from "./views/awareness.js";
import { companion } from "./views/companion.js";
import { memory } from "./views/memory.js";
import { models } from "./views/models.js";
import { integrations } from "./views/integrations.js";
import { devices } from "./views/devices.js";
import { skills } from "./views/skills.js";
import { agents } from "./views/agents.js";
import { home } from "./views/home.js";
import { vision } from "./views/vision.js";
import { runtime } from "./views/runtime.js";
import { tools } from "./views/tools.js";
import { family } from "./views/family.js";
import { nas } from "./views/nas.js";
import { files } from "./views/files.js";
import { logs } from "./views/logs.js";
import { settings } from "./views/settings.js";

const VIEWS = [
    dashboard, awareness, companion, memory, models,
    integrations, devices, skills, agents, tools, home, vision, runtime, family, nas, files, logs, settings
];

const GROUPS = [
    { label: "Pantau", ids: ["dashboard", "awareness", "logs"] },
    { label: "Kerja", ids: ["aether", "memory", "models", "skills", "agents", "tools", "runtime"] },
    { label: "Sistem", ids: ["home", "vision", "nas", "files", "devices", "family", "integrations", "settings"] }
];

let currentView = null;

let pollTimer = null;

/** Menahan reconnect beruntun saat daemon sedang mati. */
let reconnectTimer = null;

// =====================================================================
// Kerangka
// =====================================================================

function buildTitlebar() {

    $("#brand-mark").innerHTML = brandMark(20);

    $("#win-min").innerHTML = icon("minimize");
    $("#win-max").innerHTML = icon("maximize");
    $("#win-close").innerHTML = icon("close");

    $("#win-min").addEventListener("click", () => window.aether.window.minimize());
    $("#win-close").addEventListener("click", () => window.aether.window.close());

    $("#win-max").addEventListener("click", async () => {
        const maximized = await window.aether.window.toggleMaximize();
        $("#win-max").innerHTML = icon(maximized ? "restore" : "maximize");
    });

    window.aether.window.onState(({ maximized }) => {
        $("#win-max").innerHTML = icon(maximized ? "restore" : "maximize");
    });

    $("#titlebar-actions").innerHTML = `
        <button class="searchbar" id="btn-cmdk" title="Command palette (Ctrl+K)">
            ${icon("search")}<span class="ph">Cari apa saja…</span><span class="kbd">⌘K</span>
        </button>
        <div class="tb-icons">
            <button class="icon-btn" id="tb-notif" title="Log & notifikasi">${icon("bell")}</button>
            <button class="icon-btn" id="tb-apps" title="Command palette">${icon("grid")}</button>
            <button class="icon-btn" id="tb-runtime" title="Runtime">${icon("play")}</button>
            <button class="icon-btn" id="tb-settings" title="Settings">${icon("gear")}</button>
        </div>
        <button class="btn ghost sm" id="btn-connect">${icon("plug")} Hubungkan</button>`;

    $("#btn-cmdk").addEventListener("click", () => openCommandPalette(paletteItems()));
    $("#tb-notif").addEventListener("click", () => navigate("logs"));
    $("#tb-apps").addEventListener("click", () => openCommandPalette(paletteItems()));
    $("#tb-runtime").addEventListener("click", () => navigate("runtime"));
    $("#tb-settings").addEventListener("click", () => navigate("settings"));

    $("#btn-connect").addEventListener("click", () => {

        if (store.get().connected) {
            disconnect();
        }
        else {
            connect();
        }

    });

}

function buildSidebar() {

    const sidebar = $("#sidebar");

    sidebar.innerHTML = GROUPS.map(group => `
        <div class="nav-group-label">${esc(group.label)}</div>
        ${group.ids.map(id => {

            const view = VIEWS.find(v => v.id === id);

            return `<button class="nav-item" data-nav="${esc(id)}">
                ${icon(view.icon)}
                <span>${esc(view.label)}</span>
                <span class="count" data-count="${esc(id)}"></span>
            </button>`;

        }).join("")}
    `).join("") + `
        <div class="sidebar-footer">
            <button class="sidebar-assistant" id="sidebar-assistant" title="Tanya Aether (⌘K)">
                <span class="sa-orb"></span>
                <span class="sa-txt">
                    <span class="sa-title">Aether Assistant</span>
                    <span class="sa-sub" id="sidebar-status">tidak terhubung</span>
                </span>
            </button>
        </div>`;

    sidebar.querySelectorAll("[data-nav]").forEach(button => {
        button.addEventListener("click", () => navigate(button.dataset.nav));
    });

    $("#sidebar-assistant")?.addEventListener("click", () => openCommandPalette(paletteItems()));

}

function navigate(id) {

    const view = VIEWS.find(v => v.id === id);

    if (!view) {
        return;
    }

    // Lepaskan sumber daya view sebelumnya (stream kamera, listener SSE).
    currentView?.unmount?.();

    currentView = view;

    document.querySelectorAll(".view").forEach(section => {
        section.classList.toggle("active", section.dataset.view === id);
    });

    document.querySelectorAll("[data-nav]").forEach(button => {
        button.classList.toggle("active", button.dataset.nav === id);
    });

    const root = document.querySelector(`#view-${id}`);

    view.render(root);

    view.mount?.(root);

    location.hash = id;

}

/** Daftar perintah untuk command palette: semua view + aksi cepat. */
function paletteItems() {

    const items = VIEWS.map(v => ({
        icon: v.icon,
        name: v.label,
        group: "Halaman",
        run: () => navigate(v.id)
    }));

    const connected = store.get().connected;

    items.push(
        { icon: connected ? "x" : "plug", name: connected ? "Putuskan daemon" : "Hubungkan daemon", group: "Aksi", run: () => connected ? disconnect() : connect() },
        { icon: "refresh", name: "Periksa ulang integrasi", group: "Aksi", run: async () => { try { await api.checkIntegrations(); toast("Integrasi diperiksa ulang", "ok"); } catch (e) { toast(e.message, "danger"); } } }
    );

    return items;
}

/** Gambar ulang view aktif bila ia bergantung pada state global. */
function refreshActiveView() {

    if (!currentView) {
        return;
    }

    if (!["dashboard"].includes(currentView.id)) {
        return;
    }

    const root = document.querySelector(`#view-${currentView.id}`);

    currentView.render(root);

    currentView.mount?.(root);

}

function updateChrome() {

    const state = store.get();

    const chip = $("#connection-chip");

    const button = $("#btn-connect");

    if (state.connecting) {
        chip.innerHTML = `<span class="spinner"></span><span class="small muted">menyambung…</span>`;
    }
    else if (state.connected) {
        chip.innerHTML = pill(shortHost(state.settings.daemonUrl), "ok");
    }
    else {
        chip.innerHTML = pill("terputus", "danger");
    }

    button.innerHTML = state.connected
        ? `${icon("x")} Putuskan`
        : `${icon("plug")} Hubungkan`;

    $("#sidebar-status").textContent = state.connected
        ? `terhubung · ${shortHost(state.settings.daemonUrl)}`
        : (state.lastError ?? "tidak terhubung");

    const o = state.overview;

    setCount("skills", o ? o.tools.total : "");
    setCount("integrations", o ? `${o.integrations.summary.online}/${o.integrations.summary.enabled}` : "");
    setCount("logs", state.logs.length || "");

    updateStatusBar(state);

}

/** Bottom status bar — denyut sistem yang selalu terlihat. */
function updateStatusBar(state) {

    const bar = $("#statusbar");
    if (!bar) return;

    const o = state.overview;
    const online = state.connected;

    const seg = (cls, label, val) =>
        `<span class="seg ${cls}"><span class="d"></span><span class="lbl">${esc(label)}</span>${val != null ? `<span class="val">${esc(val)}</span>` : ""}</span>`;

    if (!online || !o) {
        bar.innerHTML = seg("off", "Daemon", "terputus")
            + `<span class="seg push"><span class="lbl">Aether OS</span></span>`;
        return;
    }

    const s = o.integrations.summary;
    bar.innerHTML =
        seg("on", "Daemon", shortHost(state.settings.daemonUrl))
        + seg(s.online >= s.enabled ? "on" : "off", "Runtime", `${s.online}/${s.enabled}`)
        + seg("", "CPU", `${Math.round(o.stats.cpu.usage)}%`)
        + seg("", "RAM", `${Math.round(o.stats.memory.usedPercent)}%`)
        + seg("", "Model", (o.ai.active ?? o.ai.defaultModel ?? "—").split("/").pop())
        + seg("", "Tools", o.tools.total)
        + seg("", "Uptime", durationShort(o.stats.daemon.uptime))
        + `<span class="seg push"><span class="lbl">Aether OS</span><span class="val">v${esc(o.daemon.version)}</span></span>`;

}

function durationShort(sec) {
    if (!Number.isFinite(sec)) return "—";
    const d = Math.floor(sec / 86400), h = Math.floor((sec / 3600) % 24), m = Math.floor((sec / 60) % 60);
    return d ? `${d}h ${h}j` : h ? `${h}j ${m}m` : `${m}m`;
}

function setCount(id, value) {

    const node = document.querySelector(`[data-count="${id}"]`);

    if (node) {
        node.textContent = value === "" ? "" : String(value);
    }

}

function shortHost(url) {

    try {
        const parsed = new URL(url);
        return `${parsed.hostname}:${parsed.port || 80}`;
    }
    catch {
        return url;
    }

}

// =====================================================================
// Koneksi
// =====================================================================

async function connect() {

    clearTimeout(reconnectTimer);

    const settingsState = store.get().settings;

    api.configure({
        baseUrl: settingsState.daemonUrl,
        token: settingsState.token
    });

    store.set({ connecting: true, lastError: null });

    updateChrome();

    try {

        const overview = await api.overview();

        store.set({
            connected: true,
            connecting: false,
            lastError: null,
            overview
        });

        store.pushHistory(overview.stats.cpu.usage, overview.stats.memory.usedPercent);

        openEventStream();

        startPolling();

        updateChrome();

        refreshActiveView();

        toast(`Terhubung ke ${shortHost(settingsState.daemonUrl)}`, "ok");

    }

    catch (error) {

        store.set({
            connected: false,
            connecting: false,
            lastError: error.message
        });

        updateChrome();

        refreshActiveView();

        toast(error.message, "danger", 5000);

        // Coba lagi sendiri supaya Console pulih begitu daemon hidup.
        scheduleReconnect();

    }

}

function disconnect() {

    clearTimeout(reconnectTimer);

    stopPolling();

    api.disconnectEvents();

    store.set({
        connected: false,
        connecting: false,
        overview: null,
        lastError: "diputuskan manual"
    });

    updateChrome();

    refreshActiveView();

}

function scheduleReconnect() {

    clearTimeout(reconnectTimer);

    if (!store.get().settings.autoConnect) {
        return;
    }

    reconnectTimer = setTimeout(connect, 8000);

}

function openEventStream() {

    api.connectEvents({

        onOpen: ({ backlog }) => {

            const state = store.get();

            state.logs = [...(backlog ?? [])];

            store.set({ logs: state.logs });

        },

        onLog: entry => store.pushLog(entry),

        onEvent: event => store.pushLog({
            id: event.id,
            time: event.time,
            level: "event",
            message: `${event.type} ${summarize(event.payload)}`
        }),

        onError: () => {

            // EventSource menyambung ulang sendiri; polling yang
            // menentukan apakah daemon benar-benar mati.

        }

    });

}

function summarize(payload) {

    if (!payload || typeof payload !== "object") {
        return "";
    }

    if (payload.id && payload.status) {
        return `${payload.id} → ${payload.status.online ? "online" : "offline"}`;
    }

    if (payload.tool) {
        return `${payload.tool}${payload.error ? ` (${payload.error})` : ""}`;
    }

    return Object.entries(payload)
        .slice(0, 3)
        .map(([key, value]) =>
            `${key}=${typeof value === "object" ? "…" : value}`)
        .join(" ");

}

function startPolling() {

    stopPolling();

    const interval = store.get().settings.pollInterval ?? 5000;

    pollTimer = setInterval(async () => {

        try {

            const overview = await api.overview();

            store.set({ overview, connected: true, lastError: null });

            store.pushHistory(
                overview.stats.cpu.usage,
                overview.stats.memory.usedPercent
            );

            updateChrome();

            // Catatan: dashboard TIDAK di-render ulang tiap poll — agar chat
            // tertanam & interaksi tak terputus. Angka live tetap di status bar
            // (updateChrome). Dashboard menyegarkan saat dibuka/berpindah view.

        }

        catch (error) {

            store.set({ connected: false, lastError: error.message });

            stopPolling();

            api.disconnectEvents();

            updateChrome();

            refreshActiveView();

            toast("Koneksi ke daemon terputus", "warn");

            scheduleReconnect();

        }

    }, interval);

}

function stopPolling() {

    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

}

// =====================================================================
// Bootstrap
// =====================================================================

async function main() {

    buildTitlebar();

    buildSidebar();

    // Command palette global (⌘K / Ctrl+K).
    document.addEventListener("keydown", e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            openCommandPalette(paletteItems());
        }
    });

    // Floating Assistant → buka command palette.
    $("#fab-assistant")?.addEventListener("click", () => openCommandPalette(paletteItems()));

    const saved = await window.aether.settings.get();

    store.set({ settings: saved });

    api.configure({ baseUrl: saved.daemonUrl, token: saved.token });

    // Log dari daemon yang dijalankan Console ikut masuk panel Logs.
    window.aether.daemon.onOutput(({ channel, text }) => {

        for (const line of text.split(/\r?\n/)) {

            if (line.trim()) {

                store.pushLog({
                    id: Date.now(),
                    time: new Date().toISOString(),
                    level: channel === "stderr" ? "error" : "info",
                    message: `[daemon] ${line}`
                });

            }

        }

    });

    window.aether.daemon.onExit(({ code }) => {

        store.patch("localDaemon", { running: false, pid: null });

        toast(`Daemon lokal berhenti (kode ${code})`, "warn");

    });

    document.addEventListener("aether:reconnect", () => connect());

    document.addEventListener("keydown", event => {

        if (event.ctrlKey && event.key >= "1" && event.key <= "9") {
            event.preventDefault();
            navigate(VIEWS[Number(event.key) - 1].id);
        }

    });

    navigate(location.hash.slice(1) || "dashboard");

    updateChrome();

    if (saved.autoConnect) {
        connect();
    }

}

main();
