import { store } from "./lib/store.js";
import { api } from "./lib/api.js";
import { icon, brandMark } from "./lib/icons.js";
import { $, esc, pill, toast } from "./lib/ui.js";

import { createHologram } from "./lib/hologram.js";
import { createWakeWord } from "./lib/wakeword.js";
import { openOverlay, isOpen as overlayOpen } from "./lib/aetherOverlay.js";

import { buildStudioApp } from "./views/apps/studio.js";
import { buildSpaceApp } from "./views/apps/space.js";
import { buildConnectApp } from "./views/apps/connect.js";

// View mandiri (dipakai apa adanya sebagai "aplikasi").
import { aether } from "./views/aether.js";
import { dashboard } from "./views/dashboard.js";
import { memory } from "./views/memory.js";
import { models } from "./views/models.js";
import { runtime } from "./views/runtime.js";
import { awareness } from "./views/awareness.js";
import { logs } from "./views/logs.js";
import { settings } from "./views/settings.js";

// =====================================================================
// Registry APLIKASI — semua navigasi lama hidup di App Launcher (1 tombol)
// =====================================================================

const goHome = () => navigate("core");

// Warna semantik (identitas): info=cyan, ai=purple, ok=green, proc=orange.
const CY = "#35d6f0", AI = "#9d6bff", OK = "#34d399", PR = "#ff9d4a";

// Kategori Control Hub — Aether di pusat, sisanya "Applications".
const CATEGORIES = ["Inti", "Kecerdasan", "Ruang", "Sistem"];

/**
 * Registry APPLICATIONS. Tiap app = kapabilitas Aether dengan metadata OS:
 * category, version, capabilities, permissions, dependencies. Status runtime
 * (running/health) diturunkan LIVE dari overview di appStatus(). Menambah app
 * = satu entri (scalable). Status = fungsi murni (maintainable).
 */
const APPS = [
    { id: "core", label: "Beranda", icon: "orb", color: CY, desc: "Pusat entitas Aether", core: true, cat: "Inti",
      version: "3.0", caps: ["Suara", "Hologram", "Perintah"], perms: ["Mikrofon"], deps: [] },
    { id: "chat", label: "Aether", icon: "chat", color: CY, desc: "Percakapan & reasoning", view: aether, cat: "Inti",
      version: "3.0", caps: ["Chat", "Voice", "Streaming"], perms: ["AI", "Mikrofon"], deps: ["Model AI", "Memori"] },
    { id: "memory", label: "Memori", icon: "brain", color: AI, desc: "Ingatan jangka panjang", view: memory, cat: "Kecerdasan",
      version: "2.4", caps: ["Recall", "Graph", "Governance"], perms: ["Baca/Tulis memori"], deps: ["Model AI"] },
    { id: "models", label: "Model AI", icon: "cpu", color: AI, desc: "Provider & token", view: models, cat: "Kecerdasan",
      version: "2.1", caps: ["Provider", "Fallback", "Usage"], perms: ["Kunci API"], deps: [] },
    { id: "studio", label: "Studio", icon: "grid", color: AI, desc: "Skills · Agent · Tools", view: buildStudioApp(goHome), consolidated: true, cat: "Kecerdasan",
      version: "1.8", caps: ["Skills", "Agent", "Tools"], perms: ["Eksekusi tool"], deps: ["Model AI"] },
    { id: "awareness", label: "Kesadaran", icon: "activity", color: AI, desc: "Konteks aktif", view: awareness, cat: "Kecerdasan",
      version: "1.2", caps: ["Konteks", "Sinyal"], perms: [], deps: ["Memori"] },
    { id: "space", label: "Ruang", icon: "home", color: OK, desc: "Rumah · Vision · NAS · Keluarga", view: buildSpaceApp(goHome), consolidated: true, cat: "Ruang",
      version: "2.0", caps: ["Smart Home", "Vision", "NAS", "Keluarga"], perms: ["Kamera", "Berkas"], deps: ["Terhubung"] },
    { id: "connect", label: "Terhubung", icon: "plug", color: OK, desc: "Perangkat · Integrasi", view: buildConnectApp(goHome), consolidated: true, cat: "Ruang",
      version: "2.0", caps: ["Perangkat", "Integrasi", "OpenClaw", "Hermes"], perms: ["Jaringan"], deps: [] },
    { id: "dashboard", label: "Ikhtisar", icon: "dashboard", color: CY, desc: "Panel sistem", view: dashboard, cat: "Sistem",
      version: "1.5", caps: ["Metrik", "Ringkasan"], perms: [], deps: [] },
    { id: "runtime", label: "Runtime", icon: "terminal", color: CY, desc: "Proses & terminal", view: runtime, cat: "Sistem",
      version: "1.6", caps: ["Proses", "Terminal", "Log"], perms: ["Shell"], deps: [] },
    { id: "logs", label: "Log", icon: "bell", color: PR, desc: "Kejadian & notifikasi", view: logs, cat: "Sistem",
      version: "1.0", caps: ["Event", "SSE"], perms: [], deps: [] },
    { id: "settings", label: "Pengaturan", icon: "gear", color: CY, desc: "Preferensi & koneksi", view: settings, cat: "Sistem",
      version: "1.4", caps: ["Preferensi", "Daemon"], perms: [], deps: [] }
];

/**
 * Status runtime sebuah app — DITURUNKAN dari data nyata (overview) supaya
 * Control Hub hidup, bukan hiasan. tone ∈ ok|ai|proc|idle|danger.
 */
function appStatus(app) {
    const s = store.get();
    if (!s.connected && app.id !== "settings" && app.id !== "core") return { tone: "idle", label: "Offline", running: false };
    const o = s.overview;
    switch (app.id) {
        case "core": return { tone: "ai", label: "Aktif", running: true };
        case "chat": return { tone: "ai", label: o?.ai?.active ? "Siap" : "Model?", running: true };
        case "connect": {
            const g = o?.integrations?.summary;
            return g ? { tone: g.online > 0 ? "ok" : "idle", label: `${g.online}/${g.enabled} online`, running: g.online > 0 } : { tone: "idle", label: "—", running: false };
        }
        case "models": return { tone: "ai", label: (o?.ai?.active ?? o?.ai?.defaultModel ?? "—").split("/").pop(), running: !!o?.ai?.active };
        case "studio": return { tone: "ok", label: `${o?.tools?.total ?? 0} tools`, running: true };
        case "runtime": return { tone: o ? "ok" : "idle", label: o ? `up ${durationShort(o.stats.daemon.uptime)}` : "—", running: !!o };
        case "logs": return { tone: s.logs.length ? "proc" : "idle", label: `${s.logs.length} event`, running: false };
        case "memory": return { tone: "ok", label: "Aktif", running: true };
        case "dashboard": return { tone: o ? "ok" : "idle", label: o ? `${Math.round(o.stats.cpu.usage)}% CPU` : "—", running: !!o };
        default: return { tone: s.connected ? "ok" : "idle", label: s.connected ? "Siap" : "Offline", running: false };
    }
}

let currentAppId = null;
let currentInstance = null;
let coreHolo = null;
let fabHolo = null;

/**
 * Hemat daya: hanya SATU entitas 3D yang animasi pada satu waktu.
 * - Inti Beranda aktif hanya saat di Beranda & overlay tutup.
 * - Orb fab disembunyikan+dijeda saat di Beranda / overlay (hindari 2 scene).
 * - Overlay punya entitasnya sendiri.
 */
function refreshHoloPower() {
    const overlay = overlayOpen();
    const onCore = currentAppId === "core";
    if (coreHolo) (onCore && !overlay) ? coreHolo.resume() : coreHolo.pause();
    const fab = document.getElementById("holo-fab");
    if (fab) fab.style.display = (onCore || overlay) ? "none" : "";
    if (fabHolo) (!onCore && !overlay) ? fabHolo.resume() : fabHolo.pause();
}

// Semua hologram hidup (Beranda + fab) → disiarkan bersama.
const holos = new Set();
const holoState = (s) => { for (const h of holos) h.setState(s); };
const holoLevel = (v) => { for (const h of holos) h.setLevel(v); };

let pollTimer = null;
let reconnectTimer = null;
let wake = null;

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

    // Tombol APPS → launcher; chip koneksi → sambung/putus.
    $("#apps-btn").addEventListener("click", toggleLauncher);
    $("#connection-chip").addEventListener("click", () => store.get().connected ? disconnect() : connect());
}

// ---- App Launcher (satu tombol → semua aplikasi) ------------------

function buildLauncher() {
    $("#launcher-close").addEventListener("click", closeLauncher);
    $("#launcher").addEventListener("click", e => { if (e.target.id === "launcher") closeLauncher(); });
    renderHub();
}

/**
 * Control Hub — bukan menu, tapi pusat kendali: kartu app HIDUP berkategori,
 * status/health/versi diturunkan dari data nyata; Aether ditampilkan sebagai
 * pengoordinasi. Dipanggil ulang saat poll agar status tetap live.
 */
function renderHub() {
    const grid = document.getElementById("app-grid");
    if (!grid) return;

    const activeCount = APPS.filter(a => !a.core && appStatus(a).running).length;
    const header = document.getElementById("hub-head");
    if (header) header.innerHTML =
        `<span class="hub-brand">AETHER</span> mengoordinasi <b>${activeCount}</b> aplikasi aktif`;

    grid.innerHTML = CATEGORIES.map(cat => {
        const apps = APPS.filter(a => a.cat === cat);
        if (!apps.length) return "";
        return `<div class="hub-cat">${esc(cat)}</div>
            <div class="hub-row">${apps.map(a => {
                const st = appStatus(a);
                return `<button class="hub-card${a.id === currentAppId ? " current" : ""}" data-app="${esc(a.id)}" style="--tile:${a.color}">
                    <div class="hub-top">
                        <span class="ico">${icon(a.icon)}</span>
                        <span class="stat stat-${st.tone}" title="${esc(st.label)}"></span>
                    </div>
                    <div class="hub-name">${esc(a.label)}${st.running ? `<span class="run">●</span>` : ""}</div>
                    <div class="hub-desc">${esc(a.desc)}</div>
                    <div class="hub-meta"><span class="ver">v${esc(a.version)}</span><span class="stt">${esc(st.label)}</span></div>
                    <div class="hub-caps">${a.caps.slice(0, 3).map(c => `<span>${esc(c)}</span>`).join("")}</div>
                </button>`;
            }).join("")}</div>`;
    }).join("");

    grid.querySelectorAll("[data-app]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.app)));
}

function toggleLauncher() { const l = $("#launcher"); l.classList.toggle("open"); if (l.classList.contains("open")) renderHub(); }
function closeLauncher() { $("#launcher").classList.remove("open"); }

// ---- Navigasi (tiap app = satu layar di #stage) -------------------

function ensureScreen(app) {
    let s = document.getElementById(`screen-${app.id}`);
    if (!s) {
        s = document.createElement("section");
        s.className = "app-screen" + (app.core ? " core" : "");
        s.id = `screen-${app.id}`;
        $("#stage").appendChild(s);
    }
    return s;
}

function navigate(id) {

    const app = APPS.find(a => a.id === id) || APPS[0];

    // Lepas sumber daya app sebelumnya.
    currentInstance?.unmount?.();
    if (currentAppId === "core") teardownCore();
    currentInstance = null;

    currentAppId = app.id;

    const screen = ensureScreen(app);
    document.querySelectorAll(".app-screen").forEach(s => s.classList.toggle("active", s === screen));

    if (app.core) {
        renderCore(screen);
    }
    else if (app.consolidated) {
        app.view.render(screen);
        currentInstance = app.view;
    }
    else {
        currentInstance = mountStandalone(screen, app);
    }

    location.hash = app.id;
    refreshHoloPower();
    closeLauncher();
}

/** Bungkus view mandiri dengan app-head (judul + kembali). */
function mountStandalone(screen, app) {
    screen.innerHTML = `
        <div class="app-head">
            <button class="back" title="Kembali ke Beranda">${icon("chevron-left") || "‹"}</button>
            <div class="title">${esc(app.label)}<small>${esc(app.desc)}</small></div>
        </div>
        <div class="app-body" style="height:calc(100% - 58px)"></div>`;
    screen.querySelector(".back").addEventListener("click", goHome);
    const body = screen.querySelector(".app-body");
    app.view.render(body);
    app.view.mount?.(body);
    return { unmount() { app.view.unmount?.(); } };
}

// ---- Beranda hologram (core) --------------------------------------

function greeting() {
    const h = new Date().getHours();
    const line = h < 5 ? "Selamat malam" : h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 19 ? "Selamat sore" : "Selamat malam";
    return { line, sub: "Ucapkan “Aether” atau ketik untuk memulai." };
}

function renderCore(screen) {

    const g = greeting();

    screen.innerHTML = `
        <div class="holo-home">
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;position:relative;">
                <div class="holo-hud">A · E · T · H · E · R &nbsp;·&nbsp; O S</div>
                <div class="holo-stage" id="core-holo"></div>
                <div class="holo-greet">${esc(g.line)}, aku <b>Aether</b></div>
                <div class="holo-sub">${esc(g.sub)}</div>
            </div>
            <div style="width:100%;">
                <div class="holo-stats" id="core-stats"></div>
                <form class="holo-prompt" id="core-prompt">
                    <input type="text" autocomplete="off" placeholder="Tanya apa saja pada Aether…" />
                    <button class="mic" type="button" id="core-mic" title="Bicara">${icon("mic")}</button>
                </form>
            </div>
        </div>`;

    try {
        coreHolo = createHologram({ maxFps: 30 });
        screen.querySelector("#core-holo").appendChild(coreHolo.el);
        holos.add(coreHolo);
        coreHolo.setState(store.get().connected ? "idle" : "offline");
    }
    catch { coreHolo = null; }

    renderCoreStats();

    // Mulai ngobrol di Beranda → live-chat hologram FULLSCREEN muncul di
    // ATAS layar (tidak dialihkan ke jendela app).
    const form = screen.querySelector("#core-prompt");
    form.addEventListener("submit", e => {
        e.preventDefault();
        const v = form.querySelector("input").value.trim();
        if (!v) return;
        form.querySelector("input").value = "";
        openOverlay({ text: v });
    });
    screen.querySelector("#core-mic").addEventListener("click", () => openOverlay({ voice: true }));
}

function renderCoreStats() {
    const el = document.getElementById("core-stats");
    if (!el) return;
    const s = store.get(), o = s.overview;
    const chip = (on, label, val) => `<span class="holo-chip${on ? "" : " off"}"><span class="d"></span>${esc(label)} <b>${esc(String(val))}</b></span>`;
    if (!s.connected || !o) { el.innerHTML = chip(false, "Daemon", "terputus"); return; }
    el.innerHTML =
        chip(true, "Daemon", shortHost(s.settings.daemonUrl))
        + chip(true, "CPU", Math.round(o.stats.cpu.usage) + "%")
        + chip(true, "RAM", Math.round(o.stats.memory.usedPercent) + "%")
        + chip(true, "Tools", o.tools.total)
        + chip(true, "Model", (o.ai.active ?? o.ai.defaultModel ?? "—").split("/").pop());
}

function teardownCore() {
    if (coreHolo) { holos.delete(coreHolo); coreHolo.destroy(); coreHolo = null; }
}

// =====================================================================
// Wake word — Aether selalu standby
// =====================================================================

function initWake() {
    wake = createWakeWord({
        onWake: () => {
            if (overlayOpen()) return;               // sudah dalam percakapan
            showWakeBadge();
            holoState("listening");
            openOverlay({ voice: true });            // hologram fullscreen + bicara langsung
        },
        onError: () => { /* diam: 'not-allowed' dll — fab manual tetap ada */ }
    });
    if (wake.available()) {
        try { wake.start(); } catch { /* butuh izin mic */ }
    }
}

let wakeBadgeTimer = null;
function showWakeBadge() {
    const b = $("#wake-badge");
    b.classList.add("show");
    clearTimeout(wakeBadgeTimer);
    wakeBadgeTimer = setTimeout(() => b.classList.remove("show"), 2600);
}

// =====================================================================
// Chrome (chip koneksi + status bar HUD)
// =====================================================================

function updateChrome() {

    const state = store.get();
    const chip = $("#connection-chip");

    if (state.connecting) {
        chip.innerHTML = `<span class="spinner"></span><span class="small muted">menyambung…</span>`;
    }
    else if (state.connected) {
        chip.innerHTML = pill(shortHost(state.settings.daemonUrl), "ok");
    }
    else {
        chip.innerHTML = pill("terputus", "danger");
    }

    if (currentAppId === "core") renderCoreStats();
    if ($("#launcher").classList.contains("open")) renderHub();   // status app live

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

function shortHost(url) {
    try { const p = new URL(url); return `${p.hostname}:${p.port || 80}`; }
    catch { return url; }
}

// =====================================================================
// Koneksi (dipertahankan dari versi sebelumnya)
// =====================================================================

async function connect() {

    clearTimeout(reconnectTimer);
    const settingsState = store.get().settings;
    api.configure({ baseUrl: settingsState.daemonUrl, token: settingsState.token });
    store.set({ connecting: true, lastError: null });
    updateChrome();

    try {
        const overview = await api.overview();
        store.set({ connected: true, connecting: false, lastError: null, overview });
        store.pushHistory(overview.stats.cpu.usage, overview.stats.memory.usedPercent);
        openEventStream();
        startPolling();
        holoState("idle");
        updateChrome();
        toast(`Terhubung ke ${shortHost(settingsState.daemonUrl)}`, "ok");
    }
    catch (error) {
        store.set({ connected: false, connecting: false, lastError: error.message });
        holoState("offline");
        updateChrome();
        toast(error.message, "danger", 5000);
        scheduleReconnect();
    }
}

function disconnect() {
    clearTimeout(reconnectTimer);
    stopPolling();
    api.disconnectEvents();
    store.set({ connected: false, connecting: false, overview: null, lastError: "diputuskan manual" });
    holoState("offline");
    updateChrome();
}

function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (!store.get().settings.autoConnect) return;
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
            id: event.id, time: event.time, level: "event",
            message: `${event.type} ${summarize(event.payload)}`
        }),
        onError: () => { /* EventSource menyambung ulang sendiri */ }
    });
}

function summarize(payload) {
    if (!payload || typeof payload !== "object") return "";
    if (payload.id && payload.status) return `${payload.id} → ${payload.status.online ? "online" : "offline"}`;
    if (payload.tool) return `${payload.tool}${payload.error ? ` (${payload.error})` : ""}`;
    return Object.entries(payload).slice(0, 3).map(([k, v]) => `${k}=${typeof v === "object" ? "…" : v}`).join(" ");
}

function startPolling() {
    stopPolling();
    const interval = store.get().settings.pollInterval ?? 5000;
    pollTimer = setInterval(async () => {
        try {
            const overview = await api.overview();
            store.set({ overview, connected: true, lastError: null });
            store.pushHistory(overview.stats.cpu.usage, overview.stats.memory.usedPercent);
            updateChrome();
        }
        catch (error) {
            store.set({ connected: false, lastError: error.message });
            stopPolling();
            api.disconnectEvents();
            holoState("offline");
            updateChrome();
            toast("Koneksi ke daemon terputus", "warn");
            scheduleReconnect();
        }
    }, interval);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// =====================================================================
// Bootstrap
// =====================================================================

async function main() {

    buildTitlebar();
    buildLauncher();

    // Ctrl+K → launcher (pencarian/nav terpadu). Escape → tutup.
    document.addEventListener("keydown", e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggleLauncher(); }
        if (e.key === "Escape") closeLauncher();
    });

    // Entitas mengambang — standby di app non-Beranda (di Beranda ia disembunyikan).
    try {
        fabHolo = createHologram({ maxFps: 24 });
        $("#holo-fab").appendChild(fabHolo.el);
        holos.add(fabHolo);
        fabHolo.setState("idle");
    }
    catch { /* WebGL tak ada → fab tetap tombol biasa */ }

    // Jeda/lanjut entitas saat overlay dibuka/ditutup (hemat daya).
    document.addEventListener("aether:overlay", refreshHoloPower);

    // Orb bulat → hologram fullscreen + bicara langsung dengan Aether.
    $("#holo-fab").addEventListener("click", () => openOverlay({ voice: true }));

    const saved = await window.aether.settings.get();
    store.set({ settings: saved });
    api.configure({ baseUrl: saved.daemonUrl, token: saved.token });

    window.aether.daemon.onOutput(({ channel, text }) => {
        for (const line of text.split(/\r?\n/)) {
            if (line.trim()) {
                store.pushLog({
                    id: Date.now(), time: new Date().toISOString(),
                    level: channel === "stderr" ? "error" : "info", message: `[daemon] ${line}`
                });
            }
        }
    });

    window.aether.daemon.onExit(({ code }) => {
        store.patch("localDaemon", { running: false, pid: null });
        toast(`Daemon lokal berhenti (kode ${code})`, "warn");
    });

    document.addEventListener("aether:reconnect", () => connect());

    navigate(location.hash.slice(1) || "core");
    updateChrome();

    initWake();

    if (saved.autoConnect) connect();
}

main();
