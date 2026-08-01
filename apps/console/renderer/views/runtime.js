import { store } from "../lib/store.js";
import { icon } from "../lib/icons.js";
import { esc, clockTime } from "../lib/ui.js";
import { terminalPanel } from "./panels/terminalPanel.js";
import { runtimeStatusPanel } from "./panels/runtimeStatusPanel.js";

/**
 * Runtime Console — VS Code × service manager.
 * Panel: Terminal · Runtime (status) · Logs · Events.
 * Terminal I/O lewat WS; sisanya (status/log/event) lewat REST/SSE (store).
 * Panel modular → panel masa depan (Metrics/Inspector) tinggal ditambah.
 */

let mounted = null;

/** Panel Logs/Events sederhana dari store (SSE) — reuse aliran yang ada. */
function logPanel(eventsOnly) {
    let el = null, timer = null;
    const draw = () => {
        if (!el) return;
        const logs = (store.get().logs || [])
            .filter(l => eventsOnly ? l.level === "event" : l.level !== "event")
            .slice(-300).reverse();
        el.innerHTML = logs.length
            ? logs.map(l => `<div class="log-line ${l.level === "error" ? "error" : l.level === "warn" ? "warn" : ""}">
                <span class="t dim">${esc(clockTime(l.time))}</span> <span class="m">${esc(l.message)}</span></div>`).join("")
            : `<div class="empty">${icon("activity")}<div>Belum ada ${eventsOnly ? "event" : "log"}.</div></div>`;
    };
    return {
        render(host) { host.innerHTML = `<div class="panel flush"><div id="rc-ls" style="max-height:66vh;overflow:auto;padding:12px"></div></div>`; el = host.querySelector("#rc-ls"); },
        mount() { draw(); timer = setInterval(draw, 1500); },
        unmount() { if (timer) clearInterval(timer); timer = null; }
    };
}

export const runtime = {

    id: "runtime",
    label: "Runtime",
    icon: "terminal",
    title: "Runtime Console",
    subtitle: "Terminal, runtime, log, dan event — satu konsol.",

    render(root) {
        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Runtime Console</h1>
                    <p>Terminal, status runtime, log &amp; event dalam satu konsol.</p>
                </div>
            </div>
            <div class="seg" id="rc-tabs">
                <button type="button" data-p="terminal" class="active">${icon("terminal")} Terminal</button>
                <button type="button" data-p="runtime">${icon("activity")} Runtime</button>
                <button type="button" data-p="logs">${icon("box")} Logs</button>
                <button type="button" data-p="events">${icon("activity")} Events</button>
            </div>
            <div id="rc-host"></div>`;
    },

    async mount(root) {
        const host = root.querySelector("#rc-host");
        const tp = terminalPanel();

        const panels = {
            terminal: tp,
            runtime: runtimeStatusPanel({
                onOpenTerminal: purpose => { open("terminal"); requestAnimationFrame(() => tp.openByPurpose(purpose)); }
            }),
            logs: logPanel(false),
            events: logPanel(true)
        };

        const open = async (p) => {
            root.querySelectorAll("#rc-tabs [data-p]").forEach(b => b.classList.toggle("active", b.dataset.p === p));
            if (mounted) mounted.unmount?.();
            host.innerHTML = "";
            const panel = panels[p];
            panel.render(host);
            await panel.mount?.(host);
            mounted = panel;
        };

        root.querySelectorAll("#rc-tabs [data-p]").forEach(b => b.addEventListener("click", () => open(b.dataset.p)));
        await open("terminal");
    },

    unmount() {
        mounted?.unmount?.();
        mounted = null;
    }

};
