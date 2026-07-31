import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, pill, duration, toast } from "../lib/ui.js";

/**
 * Kesadaran — satu layar yang menyatukan seluruh sinyal rumah,
 * plus ringkasan naratif dari Aether ("seperti menyambut pemilik").
 */

export const awareness = {

    id: "awareness",
    label: "Kesadaran",
    icon: "activity",
    title: "Kesadaran Rumah",
    subtitle: "Semua sinyal jadi satu — dan Aether memahaminya.",

    render(root) {

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Kesadaran Rumah</h1>
                    <p>Semua sinyal jadi satu — dan Aether memahaminya.</p>
                </div>
                <div class="actions">
                    <button class="btn ghost sm" id="aw-refresh">${icon("refresh")} Segarkan</button>
                    <button class="btn primary sm" id="aw-brief">${icon("orb")} Minta ringkasan Aether</button>
                </div>
            </div>

            <div class="stack">
                <div class="panel" id="aw-brief-panel" style="display:none"></div>
                <div id="aw-grid" class="grid cols-4"></div>
            </div>`;

    },

    async mount(root) {

        await draw(root);

        root.querySelector("#aw-refresh").addEventListener("click", () => draw(root));

        root.querySelector("#aw-brief").addEventListener("click", async () => {
            const panel = root.querySelector("#aw-brief-panel");
            panel.style.display = "";
            panel.innerHTML = `<div class="row"><span class="spinner"></span>
                <span class="small muted">Aether merangkum keadaan rumah…</span></div>`;
            try {
                const r = await api.contextBrief();
                panel.innerHTML = `
                    <div class="panel-head"><h2>${icon("orb")} Kata Aether</h2></div>
                    <div class="bubble" style="max-width:none">${esc(r.brief)}</div>
                    ${r.note ? `<div class="small dim" style="margin-top:6px">${esc(r.note)}</div>` : ""}`;
            }
            catch (error) {
                panel.innerHTML = `<div class="empty">${icon("alert")}<div class="danger-text">${esc(error.message)}</div></div>`;
            }
        });

    }

};

async function draw(root) {

    const grid = root.querySelector("#aw-grid");

    grid.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="row">
        <span class="spinner"></span><span class="small muted">Mengumpulkan sinyal…</span></div></div>`;

    let c;
    try {
        c = await api.context();
    }
    catch (error) {
        grid.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="empty">${icon("alert")}<div class="danger-text">${esc(error.message)}</div></div></div>`;
        return;
    }

    const cards = [];

    // Sistem
    cards.push(card("cpu", "Sistem", `${c.system?.cpu ?? "?"}%`, [
        `RAM ${c.system?.memory ?? "?"}%`,
        `${c.system?.host ?? ""} · aktif ${duration(c.system?.uptime ?? 0)}`
    ]));

    // AI
    cards.push(card("orb", "AI", c.ai?.platform ?? "?", [
        `model ${c.ai?.model ?? "default"}`,
        (c.ai?.providers ?? []).map(p => `${p.online ? "●" : "○"} ${p.id}`).join("  ")
    ]));

    // Memori
    cards.push(card("brain", "Memori", `${c.memory?.memories ?? 0}`, [
        `${c.memory?.entities ?? 0} entitas · ${c.memory?.documents ?? 0} dok`,
        `embedding ${c.memory?.embeddings ? "aktif" : "mati"}`
    ]));

    // Rumah
    const home = c.home ?? {};
    cards.push(card("home", "Rumah", home.online ? `${home.on ?? 0}/${home.total ?? 0}` : "—", [
        home.online ? "perangkat menyala" : (home.configured ? "HA offline" : "belum diatur")
    ], home.online ? "ok" : (home.configured ? "danger" : "idle")));

    // Sensor
    const sensors = c.sensors ?? {};
    cards.push(card("sensor", "Sensor", `${sensors.total ?? 0}`, [
        (sensors.readings ?? []).filter(r => r.ok).slice(0, 2)
            .map(r => `${r.label}: ${r.value}${r.unit ?? ""}`).join(" · ") || "tak ada bacaan"
    ]));

    // Kamera
    cards.push(card("camera", "Kamera", `${c.cameras?.total ?? 0}`, [
        (c.cameras?.cameras ?? []).map(x => x.label).slice(0, 3).join(", ") || "belum ada"
    ]));

    // Orang
    const people = c.people ?? {};
    cards.push(card("camera", "Orang (Immich)", people.configured ? `${people.people ?? 0}` : "—", [
        people.configured ? "wajah dikenal" : "belum diatur"
    ], people.configured ? "ok" : "idle"));

    // Integrasi
    const ig = c.integrations ?? {};
    cards.push(card("link", "Integrasi", `${ig.online ?? 0}/${ig.enabled ?? 0}`, ["online"]));

    // Agents
    const agents = c.agents?.agents ?? [];
    cards.push(card("activity", "Agents", `${agents.filter(a => a.online).length}/${agents.length}`, [
        agents.map(a => `${a.online ? "●" : "○"} ${a.id}`).join("  ")
    ]));

    // Telegram
    const tg = c.telegram ?? {};
    cards.push(card("send", "Telegram", tg.running ? "aktif" : (tg.configured ? "mati" : "—"), [
        tg.running ? `@${tg.username}` : (tg.configured ? "tidak jalan" : "belum diatur")
    ], tg.running ? "ok" : (tg.configured ? "danger" : "idle")));

    grid.innerHTML = cards.join("");

}

function card(iconName, label, value, metas = [], tone = null) {
    return `
        <div class="stat">
            <div class="label">${icon(iconName)} ${esc(label)}</div>
            <div class="value" style="font-size:${String(value).length > 8 ? "16px" : "24px"}">
                ${tone ? pill(String(value), tone) : esc(String(value))}
            </div>
            ${metas.filter(Boolean).map(m => `<div class="meta">${esc(m)}</div>`).join("")}
        </div>`;
}
