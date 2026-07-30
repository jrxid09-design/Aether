import { store } from "./lib/store.js";
import { api } from "./lib/api.js";
import { icon, brandMark } from "./lib/icons.js";
import { $, esc, pill, toast } from "./lib/ui.js";

import { dashboard } from "./views/dashboard.js";
import { aether } from "./views/aether.js";
import { chat } from "./views/chat.js";
import { memory } from "./views/memory.js";
import { models } from "./views/models.js";
import { integrations } from "./views/integrations.js";
import { devices } from "./views/devices.js";
import { plugins } from "./views/plugins.js";
import { studio } from "./views/studio.js";
import { agents } from "./views/agents.js";
import { home } from "./views/home.js";
import { logs } from "./views/logs.js";
import { settings } from "./views/settings.js";

const VIEWS = [
    dashboard, aether, chat, memory, models,
    integrations, devices, plugins, studio, agents, home, logs, settings
];

const GROUPS = [
    { label: "Pantau", ids: ["dashboard", "logs"] },
    { label: "Kerja", ids: ["aether", "chat", "memory", "models", "plugins", "studio", "agents"] },
    { label: "Sistem", ids: ["home", "integrations", "devices", "settings"] }
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
        <button class="btn ghost sm" id="btn-connect">${icon("plug")} Hubungkan</button>`;

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
            <div class="small dim" id="sidebar-status">tidak terhubung</div>
        </div>`;

    sidebar.querySelectorAll("[data-nav]").forEach(button => {
        button.addEventListener("click", () => navigate(button.dataset.nav));
    });

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

    setCount("plugins", o ? o.tools.total : "");
    setCount("integrations", o ? `${o.integrations.summary.online}/${o.integrations.summary.enabled}` : "");
    setCount("logs", state.logs.length || "");

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

            refreshActiveView();

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
