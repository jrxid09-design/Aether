import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, bytes, pill, toast } from "../lib/ui.js";

/**
 * NAS — gaya DiskStation Manager (Synology). Data nyata dari daemon:
 * Storage Manager (pool + volume), App Center (Immich), SMART, Docker,
 * jaringan. Immich dipasang/dikelola dari sini; foto/video ke iPhone
 * lewat app Immich resmi.
 */
let lastIp = null;

export const nas = {

    id: "nas",
    label: "NAS",
    icon: "server",
    title: "NAS",
    subtitle: "DiskStation Aether — penyimpanan, aplikasi, dan kesehatan disk.",

    render(root) {
        root.innerHTML = `
            <div class="view-head">
                <div><h1>NAS</h1><p>DiskStation Aether — penyimpanan, aplikasi, dan kesehatan disk.</p></div>
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
    body.innerHTML = `<div class="panel"><div class="row"><span class="spinner"></span><span class="small muted">Membaca DiskStation…</span></div></div>`;

    let s, immich, cfg;
    try {
        [s, immich, cfg] = await Promise.all([api.nasStatus(), api.immichStatus().catch(() => null), api.nasConfig().catch(() => ({ pool: null }))]);
    }
    catch (e) { body.innerHTML = `<div class="panel"><div class="empty">${icon("alert")}<div class="danger-text">${esc(e.message)}</div></div></div>`; return; }

    lastIp = s.network[0]?.address ?? "IP-PC";
    const pool = cfg?.pool ?? s.pool ?? null;

    body.innerHTML = `
        <div class="metrics">
            ${metric("server", "DiskStation", esc(s.host), s.platform)}
            ${metric("box", "Storage Pool", pool ? "aktif" : "belum diatur", pool ? esc(pool) : "pilih disk")}
            ${metric("cpu", "SMART", s.smart.available ? `${s.smart.devices.length} disk` : "n/a", s.smart.available ? "sehat" : "smartctl absen")}
            ${metric("terminal", "Immich", immich?.available ? (immich.running ? "aktif" : "siap") : "n/a", immich?.available ? `${immich.running} layanan` : "docker absen")}
        </div>

        <div class="grid cols-2">
            ${storagePanel(s, pool)}
            ${appCenter(immich, pool)}
        </div>

        <div class="grid cols-2">
            <div class="panel">
                <div class="panel-head"><h2>${icon("cpu")} Kesehatan Disk (SMART)</h2></div>
                ${smartPanel(s.smart)}
            </div>
            <div class="panel">
                <div class="panel-head"><h2>${icon("link")} Jaringan</h2></div>
                ${s.network.length
                    ? s.network.map(n => `<div class="list-item"><div style="flex:1"><div class="title">${esc(n.name)}</div><div class="sub mono">${esc(n.mac ?? "")}</div></div><span class="tag mono">${esc(n.address)}</span></div>`).join("")
                    : `<div class="empty">${icon("link")}<div>Tak ada antarmuka aktif.</div></div>`}
            </div>
        </div>

        <div class="panel">
            <div class="panel-head"><h2>${icon("terminal")} Docker Containers</h2>
                <span class="hint push">${s.docker.available ? s.docker.containers.length : "—"}</span></div>
            ${dockerPanel(s.docker)}
        </div>`;

    wire(root, s);
}

function storagePanel(s, pool) {
    return `
        <div class="panel">
            <div class="panel-head"><h2>${icon("box")} Storage Manager</h2><span class="hint push">${s.volumes.length} volume</span></div>
            <div class="field" style="margin-bottom:12px">
                <label>Disk untuk penyimpanan NAS (Storage Pool)</label>
                <div class="row" style="gap:8px">
                    <select id="nas-pool-vol" style="flex:1">
                        <option value="">— pilih disk —</option>
                        ${s.volumes.map(v => `<option value="${esc(v.mount)}">${esc(v.mount)} ${v.label ? `(${esc(v.label)})` : ""} · ${bytes(v.free)} bebas</option>`).join("")}
                    </select>
                    <button class="btn primary sm" id="nas-pool-set">${icon("check")} Jadikan Pool</button>
                </div>
                <span class="help">${pool ? `Pool aktif: <span class="mono">${esc(pool)}</span>` : "Belum ada pool. Pilih disk (mis. D:) — data NAS & Immich disimpan di sana."}</span>
            </div>
            ${s.volumes.length === 0
                ? `<div class="empty">${icon("box")}<div>Tak ada volume terbaca.</div></div>`
                : s.volumes.map(v => volRow(v, s.poolMount)).join("")}
        </div>`;
}

function appCenter(immich, pool) {
    const av = immich?.available;
    const running = immich?.running > 0;
    const tone = !av ? "idle" : running ? "ok" : "warn";
    const state = !av ? "Docker tak aktif" : running ? "Berjalan" : (immich.installed ? "Terpasang, mati" : "Belum dipasang");
    return `
        <div class="panel">
            <div class="panel-head"><h2>${icon("box")} App Center</h2></div>
            <div class="panel agent-card" style="background:var(--bg-inset)">
                <div class="top">
                    <span class="tile">${icon("camera")}</span>
                    <div style="flex:1;min-width:0">
                        <div class="row" style="gap:8px"><span class="nm">Immich</span> ${pill(state, tone)}</div>
                        <div class="rl">Backup foto &amp; video pribadi</div>
                    </div>
                </div>
                <div class="desc">Galeri mandiri seperti Google Photos, tapi di NAS-mu sendiri. Foto/video dari iPhone tersimpan otomatis.</div>
                ${!pool ? `<div class="small warn-text">${icon("alert")} Pilih Storage Pool dulu di Storage Manager.</div>` : ""}
                ${av ? `<div class="small dim">Data: <span class="mono">${esc(immich.dataRoot)}</span></div>` : `<div class="small dim">${esc(immich?.reason ?? "Docker belum tersedia di mesin ini.")}</div>`}
                <div class="row" style="gap:8px;flex-wrap:wrap">
                    <button class="btn primary sm" id="immich-up" ${!pool ? "disabled" : ""}>${icon("play")} ${immich?.installed ? "Nyalakan" : "Pasang & Nyalakan"}</button>
                    <button class="btn ghost sm" id="immich-down" ${immich?.installed ? "" : "disabled"}>${icon("stop")} Matikan</button>
                    <button class="btn ghost sm" id="immich-open">${icon("link")} Buka Immich</button>
                </div>
            </div>
            <div class="divider"></div>
            <div class="small">
                <div style="font-weight:600;margin-bottom:4px">${icon("chat")} Sambungkan iPhone</div>
                <div class="dim">1. Install app <strong>Immich</strong> dari App Store.
                2. Server URL: <span class="mono">http://${esc(lastIp)}:2283</span>.
                3. Login, aktifkan <em>Backup</em> → foto &amp; video otomatis masuk NAS.</div>
            </div>
        </div>`;
}

function smartPanel(smart) {
    if (!smart.available) return `<div class="empty">${icon("alert")}<div>${esc(smart.reason)}</div></div>`;
    if (!smart.devices.length) return `<div class="empty">${icon("cpu")}<div>Tak ada disk SMART terdeteksi.</div></div>`;
    return `<div class="scroll-x"><table class="table">
        <thead><tr><th>Device</th><th>Model</th><th>Health</th><th>Suhu</th><th>Kapasitas</th></tr></thead>
        <tbody>${smart.devices.map(d => `<tr>
            <td class="mono small">${esc(d.device)}</td><td class="small">${esc(d.model ?? "—")}</td>
            <td>${pill(d.health, d.health === "PASSED" ? "ok" : d.health === "FAILED" ? "danger" : "idle")}</td>
            <td class="mono small">${d.tempC != null ? d.tempC + "°C" : "—"}</td>
            <td class="mono small">${d.capacity ? bytes(d.capacity) : "—"}</td>
        </tr>`).join("")}</tbody></table></div>`;
}

function dockerPanel(docker) {
    if (!docker.available) return `<div class="empty">${icon("alert")}<div>${esc(docker.reason)}</div></div>`;
    if (!docker.containers.length) return `<div class="empty">${icon("terminal")}<div>Tak ada container berjalan.</div></div>`;
    return `<div class="scroll-x"><table class="table">
        <thead><tr><th>Nama</th><th>Image</th><th>Status</th></tr></thead>
        <tbody>${docker.containers.map(c => `<tr>
            <td>${esc(c.name)}</td><td class="mono small">${esc(c.image)}</td>
            <td>${pill(esc(c.status), /up/i.test(c.status) ? "ok" : "idle")}</td>
        </tr>`).join("")}</tbody></table></div>`;
}

function volRow(v, poolMount) {
    const tone = v.usedPercent >= 90 ? "var(--danger)" : v.usedPercent >= 75 ? "var(--warn)" : "var(--accent-1)";
    const isPool = poolMount && v.mount.toUpperCase() === poolMount.toUpperCase();
    return `
        <div style="padding:10px 2px">
            <div class="row" style="gap:10px;margin-bottom:6px">
                <span class="tile" style="width:30px;height:30px">${icon("box")}</span>
                <div style="flex:1;min-width:0">
                    <div class="title">${esc(v.mount)} ${v.label ? `<span class="small dim">${esc(v.label)}</span>` : ""} ${isPool ? pill("Pool NAS", "ok") : ""}</div>
                    <div class="sub">${bytes(v.used)} / ${bytes(v.total)} · ${bytes(v.free)} bebas${v.fs ? ` · ${esc(v.fs)}` : ""}</div>
                </div>
                <span class="mono" style="font-size:15px;color:${tone}">${v.usedPercent}%</span>
            </div>
            <div class="progress"><div class="bar" style="width:${v.usedPercent}%;background:${tone}"></div></div>
        </div>`;
}

function metric(iconName, label, value, sub) {
    return `<div class="metric"><div class="k">${icon(iconName)} ${esc(label)}</div>
        <div class="v" style="font-size:18px">${value}</div><div class="s">${esc(sub ?? "")}</div></div>`;
}

function wire(root, s) {
    root.querySelector("#nas-pool-set")?.addEventListener("click", async () => {
        const mount = root.querySelector("#nas-pool-vol").value;
        if (!mount) return toast("Pilih disk dulu.", "warn");
        const sep = mount.endsWith(":") ? "\\" : (mount.includes("\\") ? "\\" : "/");
        const pool = `${mount}${sep}AetherNAS`;
        try { await api.nasSetConfig(pool); toast(`Pool NAS: ${pool}`, "ok"); draw(root); }
        catch (e) { toast(e.message, "danger"); }
    });

    root.querySelector("#immich-up")?.addEventListener("click", async () => {
        try { const r = await api.immichUp(); toast(r.note ?? "Immich dinyalakan", "ok", 6000); setTimeout(() => draw(root), 3000); }
        catch (e) { toast(e.message, "danger"); }
    });
    root.querySelector("#immich-down")?.addEventListener("click", async () => {
        try { await api.immichDown(); toast("Immich dimatikan", "ok"); draw(root); }
        catch (e) { toast(e.message, "danger"); }
    });
    root.querySelector("#immich-open")?.addEventListener("click", () => {
        window.open(`http://${lastIp}:2283`, "_blank");
    });
}
