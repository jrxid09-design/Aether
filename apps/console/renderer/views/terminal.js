import { store } from "../lib/store.js";
import { icon } from "../lib/icons.js";
import { esc, toast } from "../lib/ui.js";
import { terminalApi } from "../lib/terminalClient.js";

/**
 * Terminal — antarmuka VS Code-like ke Terminal Runtime daemon.
 * Tab, rename, tutup, cari output, salin/tempel, scrollback, bersihkan.
 * I/O lewat WebSocket (xterm.js); lifecycle lewat REST.
 */

// id → { meta, term, fit, search, conn, pane }
const tabs = new Map();
let activeId = null;

const THEME = {
    background: "#0a0e1a", foreground: "#e8ecff", cursor: "#22d3ee",
    selectionBackground: "#264f78",
    black: "#0a0e1a", red: "#fb7185", green: "#34d399", yellow: "#fbbf24",
    blue: "#7c8cff", magenta: "#c084fc", cyan: "#22d3ee", white: "#e8ecff",
    brightBlack: "#5e6788"
};

export const terminal = {

    id: "terminal",
    label: "Terminal",
    icon: "terminal",
    title: "Terminal",
    subtitle: "Terminal persisten yang dibagi Aether & kamu.",

    render(root) {
        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Terminal</h1>
                    <p>Terminal persisten yang dibagi Aether &amp; kamu.</p>
                </div>
                <div class="actions">
                    <select id="term-shell" title="Shell" style="width:130px"></select>
                    <button class="btn primary sm" id="term-new">${icon("plus")} Baru</button>
                    <input type="text" id="term-search" placeholder="cari output…" style="width:150px">
                    <button class="btn ghost sm" id="term-clear">Bersihkan</button>
                    <button class="btn ghost sm" id="term-copy">Salin</button>
                    <button class="btn ghost sm" id="term-paste">Tempel</button>
                </div>
            </div>
            <div class="term-tabs" id="term-tabs"></div>
            <div class="term-host" id="term-host">
                <div class="empty" id="term-empty">${icon("terminal")}
                    <div>Belum ada terminal. Tekan <strong>Baru</strong> untuk membuka.</div></div>
            </div>`;
    },

    async mount(root) {
        if (!store.get().connected) {
            root.querySelector("#term-host").innerHTML =
                `<div class="empty">${icon("plug")}<div>Sambungkan ke daemon dulu.</div></div>`;
            return;
        }
        if (typeof window.Terminal !== "function") {
            root.querySelector("#term-host").innerHTML =
                `<div class="empty danger-text">xterm.js gagal dimuat (vendor/xterm).</div>`;
            return;
        }

        let data;
        try { data = (await terminalApi.list()).data; }
        catch (error) { toast(`Terminal: ${error.message}`, "danger"); return; }

        if (!data.available) {
            root.querySelector("#term-host").innerHTML =
                `<div class="empty warn-text">Runtime terminal nonaktif.<br>Jalankan <span class="mono">npm install node-pty</span> lalu mulai ulang daemon.</div>`;
            return;
        }

        const shellSel = root.querySelector("#term-shell");
        shellSel.innerHTML = (data.shells || []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");

        // Buka kembali terminal yang masih hidup (attach → replay snapshot).
        for (const meta of data.terminals || []) this._open(root, meta);
        if (!tabs.size) this._showEmpty(root, true);

        root.querySelector("#term-new").addEventListener("click", async () => {
            try {
                const res = await terminalApi.create({ shell: shellSel.value, terminalType: "USER" });
                this._open(root, res.data);
            }
            catch (error) { toast(error.message, "danger"); }
        });

        root.querySelector("#term-clear").addEventListener("click", () => tabs.get(activeId)?.term.clear());

        root.querySelector("#term-copy").addEventListener("click", async () => {
            const sel = tabs.get(activeId)?.term.getSelection();
            if (sel) { try { await navigator.clipboard.writeText(sel); toast("Disalin", "ok", 1500); } catch { /* */ } }
        });

        root.querySelector("#term-paste").addEventListener("click", async () => {
            try { const t = await navigator.clipboard.readText(); tabs.get(activeId)?.conn.input(t); } catch { /* */ }
        });

        const searchInput = root.querySelector("#term-search");
        searchInput.addEventListener("keydown", e => {
            if (e.key === "Enter") tabs.get(activeId)?.search.findNext(searchInput.value, { incremental: false });
        });

        this._onResize = () => { const t = tabs.get(activeId); if (t) { try { t.fit.fit(); t.conn.resize(t.term.cols, t.term.rows); } catch { /* */ } } };
        window.addEventListener("resize", this._onResize);
    },

    unmount() {
        window.removeEventListener("resize", this._onResize || (() => {}));
        for (const t of tabs.values()) {
            try { t.conn.close(); } catch { /* */ }
            try { t.term.dispose(); } catch { /* */ }
        }
        tabs.clear();
        activeId = null;
    },

    // ---- internal -------------------------------------------------

    _showEmpty(root, show) {
        const e = root.querySelector("#term-empty");
        if (e) e.style.display = show ? "" : "none";
    },

    _open(root, meta) {
        if (tabs.has(meta.id)) { this._switch(root, meta.id); return; }
        this._showEmpty(root, false);

        const host = root.querySelector("#term-host");
        const pane = document.createElement("div");
        pane.className = "term-pane";
        pane.style.display = "none";
        host.appendChild(pane);

        const term = new window.Terminal({
            fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
            fontSize: 13, cursorBlink: true, scrollback: 5000,
            allowProposedApi: true, theme: THEME
        });
        const fit = new window.FitAddon.FitAddon();
        const search = new window.SearchAddon.SearchAddon();
        term.loadAddon(fit);
        term.loadAddon(search);
        term.open(pane);

        const conn = terminalApi.stream(meta.id, {
            onSnapshot: f => { if (f.data) term.write(f.data); },
            onData: d => term.write(d),
            onExit: code => term.write(`\r\n\x1b[90m[proses berakhir: ${code}]\x1b[0m\r\n`)
        });
        term.onData(d => conn.input(d));

        tabs.set(meta.id, { meta, term, fit, search, conn, pane });
        this._renderTabs(root);
        this._switch(root, meta.id);
    },

    _switch(root, id) {
        activeId = id;
        for (const [tid, t] of tabs) t.pane.style.display = tid === id ? "" : "none";
        this._renderTabs(root);
        const t = tabs.get(id);
        if (t) {
            requestAnimationFrame(() => {
                try { t.fit.fit(); t.conn.resize(t.term.cols, t.term.rows); t.term.focus(); } catch { /* */ }
            });
        }
    },

    _renderTabs(root) {
        const bar = root.querySelector("#term-tabs");
        bar.innerHTML = [...tabs.values()].map(t => {
            const sys = t.meta.terminalType === "SYSTEM";
            return `<div class="term-tab ${t.meta.id === activeId ? "active" : ""}" data-tab="${esc(t.meta.id)}" title="${esc(t.meta.shell)} · ${esc(t.meta.terminalType)}">
                ${sys ? "🔒 " : ""}<span class="lbl">${esc(t.meta.name)}</span>
                <span class="x" data-close="${esc(t.meta.id)}">✕</span>
            </div>`;
        }).join("");

        bar.querySelectorAll("[data-tab]").forEach(el => {
            el.addEventListener("click", ev => {
                if (ev.target.dataset.close) return;
                this._switch(root, el.dataset.tab);
            });
            el.addEventListener("dblclick", () => this._rename(root, el.dataset.tab));
        });
        bar.querySelectorAll("[data-close]").forEach(x =>
            x.addEventListener("click", () => this._close(root, x.dataset.close)));
    },

    async _rename(root, id) {
        const t = tabs.get(id);
        if (!t) return;
        const name = window.prompt("Nama terminal:", t.meta.name);
        if (!name || name === t.meta.name) return;
        try { t.meta = (await terminalApi.rename(id, name)).data; this._renderTabs(root); }
        catch (error) { toast(error.message, "danger"); }
    },

    async _close(root, id) {
        const t = tabs.get(id);
        if (!t) return;
        let force = false;
        if (t.meta.terminalType === "SYSTEM") {
            if (!window.confirm(`"${t.meta.name}" adalah terminal SYSTEM. Tetap tutup?`)) return;
            force = true;
        }
        try { await terminalApi.close(id, force); }
        catch (error) { toast(error.message, "danger"); return; }

        try { t.conn.close(); } catch { /* */ }
        try { t.term.dispose(); } catch { /* */ }
        t.pane.remove();
        tabs.delete(id);

        if (activeId === id) {
            const next = tabs.keys().next().value;
            if (next) this._switch(root, next);
            else { activeId = null; this._showEmpty(root, true); }
        }
        this._renderTabs(root);
    }

};
