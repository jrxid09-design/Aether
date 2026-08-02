import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, bytes, pill, toast } from "../lib/ui.js";

/**
 * NAS — penyimpanan & host. Semua data nyata dari daemon (volume, SMART,
 * Docker, jaringan). Bagian yang butuh tool eksternal (smartctl/docker)
 * ditandai apa adanya bila tak tersedia — tak ada angka karangan.
 */
export const nas = {

    id: "nas",
    label: "NAS",
    icon: "server",
    title: "NAS",
    subtitle: "Penyimpanan, kesehatan disk, container, dan jaringan.",

    render(root) {
        root.innerHTML = `
            <div class="view-head">
                <div><h1>NAS</h1><p>Penyimpanan, kesehatan disk, container, dan jaringan.</p></div>
                <div class="actions"><button class="btn ghost sm" id="nas-refresh">${icon("refresh")} Muat ulang</button></div>
            </div>
            <div id="nas-body" class="stack"></div>`;
    },

    async mount(root) {
        const load = () => draw(root);
        root.querySelector("#nas-refresh").addEventListener("click", load);
        await load();
    }

};

async function draw(root) {

    const body = root.querySelector("#nas-body");
    body.innerHTML = `<div class="panel"><div class="row"><span class="spinner"></span><span class="small muted">Membaca penyimpanan…</span></div></div>`;

    let s;
    try { s = await api.nasStatus(); }
    catch (e) { body.innerHTML = `<div class="panel"><div class="empty">${icon("alert")}<div class="danger-text">${esc(e.message)}</div></div></div>`; return; }

    body.innerHTML = `
        <div class="metrics">
            ${metric("server", "Host", esc(s.host), s.platform)}
            ${metric("box", "Volume", s.volumes.length, "terpasang")}
            ${metric("cpu", "SMART", s.smart.available ? `${s.smart.devices.length} disk` : "n/a", s.smart.available ? "terbaca" : "smartctl absen")}
            ${metric("terminal", "Container", s.docker.available ? s.docker.containers.length : "n/a", s.docker.available ? "berjalan" : "docker absen")}
        </div>

        <div class="panel">
            <div class="panel-head"><h2>${icon("box")} Penyimpanan</h2><span class="hint push">${s.volumes.length} volume</span></div>
            ${s.volumes.length === 0
                ? `<div class="empty">${icon("box")}<div>Tak ada volume terbaca.</div></div>`
                : s.volumes.map(volRow).join("")}
        </div>

        <div class="grid cols-2">
            <div class="panel">
                <div class="panel-head"><h2>${icon("cpu")} Kesehatan Disk (SMART)</h2></div>
                ${s.smart.available
                    ? (s.smart.devices.length
                        ? `<div class="scroll-x"><table class="table">
                            <thead><tr><th>Device</th><th>Model</th><th>Health</th><th>Suhu</th><th>Kapasitas</th></tr></thead>
                            <tbody>${s.smart.devices.map(d => `<tr>
                                <td class="mono small">${esc(d.device)}</td>
                                <td class="small">${esc(d.model ?? "—")}</td>
                                <td>${pill(d.health, d.health === "PASSED" ? "ok" : d.health === "FAILED" ? "danger" : "idle")}</td>
                                <td class="mono small">${d.tempC != null ? d.tempC + "°C" : "—"}</td>
                                <td class="mono small">${d.capacity ? bytes(d.capacity) : "—"}</td>
                            </tr>`).join("")}</tbody></table></div>`
                        : `<div class="empty">${icon("cpu")}<div>Tak ada disk SMART terdeteksi.</div></div>`)
                    : `<div class="empty">${icon("alert")}<div>${esc(s.smart.reason)}</div></div>`}
            </div>
            <div class="panel">
                <div class="panel-head"><h2>${icon("link")} Jaringan</h2></div>
                ${s.network.length
                    ? s.network.map(n => `<div class="list-item">
                        <div style="flex:1"><div class="title">${esc(n.name)}</div><div class="sub mono">${esc(n.mac ?? "")}</div></div>
                        <span class="tag mono">${esc(n.address)}</span></div>`).join("")
                    : `<div class="empty">${icon("link")}<div>Tak ada antarmuka aktif.</div></div>`}
            </div>
        </div>

        <div class="panel">
            <div class="panel-head"><h2>${icon("terminal")} Docker Containers</h2>
                <span class="hint push">${s.docker.available ? s.docker.containers.length : "—"}</span></div>
            ${s.docker.available
                ? (s.docker.containers.length
                    ? `<div class="scroll-x"><table class="table">
                        <thead><tr><th>Nama</th><th>Image</th><th>Status</th></tr></thead>
                        <tbody>${s.docker.containers.map(c => `<tr>
                            <td>${esc(c.name)}</td><td class="mono small">${esc(c.image)}</td>
                            <td>${pill(esc(c.status), /up/i.test(c.status) ? "ok" : "idle")}</td>
                        </tr>`).join("")}</tbody></table></div>`
                    : `<div class="empty">${icon("terminal")}<div>Tak ada container berjalan.</div></div>`)
                : `<div class="empty">${icon("alert")}<div>${esc(s.docker.reason)}</div></div>`}
        </div>`;
}

function volRow(v) {
    const tone = v.usedPercent >= 90 ? "var(--danger)" : v.usedPercent >= 75 ? "var(--warn)" : "var(--accent-1)";
    return `
        <div style="padding:10px 2px">
            <div class="row" style="gap:10px;margin-bottom:6px">
                <span class="tile" style="width:30px;height:30px">${icon("box")}</span>
                <div style="flex:1;min-width:0">
                    <div class="title">${esc(v.mount)} ${v.label ? `<span class="small dim">${esc(v.label)}</span>` : ""}</div>
                    <div class="sub">${bytes(v.used)} / ${bytes(v.total)} terpakai · ${bytes(v.free)} bebas${v.fs ? ` · ${esc(v.fs)}` : ""}</div>
                </div>
                <span class="mono" style="font-size:15px;color:${tone}">${v.usedPercent}%</span>
            </div>
            <div class="progress"><div class="bar" style="width:${v.usedPercent}%;background:${tone}"></div></div>
        </div>`;
}

function metric(iconName, label, value, sub) {
    return `<div class="metric">
        <div class="k">${icon(iconName)} ${esc(label)}</div>
        <div class="v" style="font-size:18px">${value}</div>
        <div class="s">${esc(sub ?? "")}</div>
    </div>`;
}
