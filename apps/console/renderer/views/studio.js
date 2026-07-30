import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, pill, toast } from "../lib/ui.js";

/**
 * Studio — tempat mengelola tool buatan Aether & buatan sendiri.
 *
 * Tiga bagian: draft menunggu persetujuan (karya Aether yang
 * belum aktif), tool aktif buatan pengguna, dan editor untuk
 * membuat/mengubah tool manual.
 */

// Form editor bertahan antar render selama satu sesi view.
let editing = null;

export const studio = {

    id: "studio",
    label: "Studio",
    icon: "tool",
    title: "Studio",
    subtitle: "Buat, tinjau, dan kelola tool buatan Aether maupun buatanmu.",

    render(root) {

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Studio</h1>
                    <p>Buat, tinjau, dan kelola tool — buatan Aether maupun buatanmu.</p>
                </div>
                <div class="actions">
                    <button class="btn ghost sm" id="st-refresh">${icon("refresh")} Muat ulang</button>
                    <button class="btn primary sm" id="st-new">${icon("plus")} Tool baru</button>
                </div>
            </div>

            <div class="stack">
                <div id="st-drafts"></div>
                <div id="st-active"></div>
                <div class="panel" id="st-editor" style="display:none"></div>
            </div>`;

    },

    async mount(root) {

        root.querySelector("#st-refresh").addEventListener("click", () => load(root));

        root.querySelector("#st-new").addEventListener("click", () => {
            editing = blankForm();
            openEditor(root);
        });

        await load(root);

    },

    unmount() {
        editing = null;
    }

};

async function load(root) {

    const draftsHost = root.querySelector("#st-drafts");
    const activeHost = root.querySelector("#st-active");

    try {

        const data = await api.forgeList();

        draftsHost.innerHTML = draftsSection(data.drafts);
        activeHost.innerHTML = activeSection(data.active);

        wireDrafts(root);
        wireActive(root);

    }

    catch (error) {
        draftsHost.innerHTML =
            `<div class="panel"><div class="empty">${icon("alert")}<div class="danger-text">${esc(error.message)}</div></div></div>`;
        activeHost.innerHTML = "";
    }

}

function draftsSection(drafts) {

    if (!drafts || drafts.length === 0) {
        return "";
    }

    return `
        <div class="panel" style="border-color:rgba(251,191,36,.3)">
            <div class="panel-head">
                <h2>${icon("alert")} Menunggu persetujuan</h2>
                <span class="hint push">${drafts.length} draft buatan Aether</span>
            </div>
            <div class="stack">
                ${drafts.map(d => `
                    <div class="list-item" data-draft="${esc(d.id)}" style="flex-wrap:wrap">
                        <div style="min-width:0;flex:1">
                            <div class="title">${esc(d.name)} <span class="tag mono">${esc(d.id)}</span></div>
                            <div class="sub">${esc(d.description || "—")}</div>
                            ${d.risks?.length
                                ? `<div class="small warn-text" style="margin-top:4px">${icon("alert")} ${d.risks.map(esc).join(" · ")}</div>`
                                : `<div class="small dim" style="margin-top:4px">tidak ada pola berisiko terdeteksi</div>`}
                        </div>
                        <button class="btn sm ghost" data-view-code>${icon("terminal")} Kode</button>
                        <button class="btn sm" data-approve>${icon("check")} Aktifkan</button>
                        <button class="btn sm danger" data-reject>${icon("x")} Tolak</button>
                        <pre class="code-view" data-code style="display:none"></pre>
                    </div>`).join("")}
            </div>
        </div>`;

}

function activeSection(active) {

    return `
        <div class="panel flush">
            <div class="panel-head" style="padding:16px 18px 0">
                <h2>Tool buatan sendiri</h2>
                <span class="hint push">${active.length}</span>
            </div>
            <div style="padding:10px 0 0">
                ${active.length === 0
                    ? `<div class="empty">${icon("tool")}
                        <div>Belum ada tool buatan sendiri.</div>
                        <div class="dim">Buat lewat tombol "Tool baru", atau minta Aether membuatnya lewat percakapan.</div></div>`
                    : active.map(t => `
                        <div class="list-item" data-active="${esc(t.id)}">
                            <div style="min-width:0;flex:1">
                                <div class="title">${esc(t.name)} <span class="tag mono">${esc(t.id)}</span>
                                    ${t.origin === "aether" ? pill("oleh Aether", "ok") : ""}</div>
                                <div class="sub">${esc(t.description || "—")}</div>
                            </div>
                            ${t.risks?.length ? `<span class="tag warn-text">${t.risks.length} risiko</span>` : ""}
                            <button class="btn sm ghost" data-edit>${icon("tool")} Edit</button>
                            <button class="btn sm danger" data-remove>${icon("trash")}</button>
                        </div>`).join("")}
            </div>
        </div>`;

}

function wireDrafts(root) {

    root.querySelectorAll("[data-draft]").forEach(row => {

        const id = row.dataset.draft;

        row.querySelector("[data-view-code]").addEventListener("click", async () => {
            const pre = row.querySelector("[data-code]");
            if (pre.style.display === "none") {
                const detail = await api.forgeRead(id);
                pre.textContent = detail.source;
                pre.style.display = "block";
            }
            else {
                pre.style.display = "none";
            }
        });

        row.querySelector("[data-approve]").addEventListener("click", async () => {
            try {
                await api.forgeApprove(id);
                toast(`Tool '${id}' diaktifkan`, "ok");
                await load(root);
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });

        row.querySelector("[data-reject]").addEventListener("click", async () => {
            if (!window.confirm(`Tolak & hapus draft '${id}'?`)) return;
            try {
                await api.forgeReject(id);
                toast(`Draft '${id}' ditolak`, "warn");
                await load(root);
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });

    });

}

function wireActive(root) {

    root.querySelectorAll("[data-active]").forEach(row => {

        const id = row.dataset.active;

        row.querySelector("[data-edit]").addEventListener("click", async () => {
            try {
                const detail = await api.forgeRead(id);
                editing = fromDetail(detail);
                openEditor(root);
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });

        row.querySelector("[data-remove]").addEventListener("click", async () => {
            if (!window.confirm(`Hapus tool '${id}'?`)) return;
            try {
                await api.forgeRemove(id);
                toast(`Tool '${id}' dihapus`, "ok");
                await load(root);
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });

    });

}

// ---- Editor ---------------------------------------------------------

function blankForm() {
    return {
        id: "",
        name: "",
        description: "",
        toolName: "",
        params: [{ name: "", type: "string", description: "", required: true }],
        code: "// args berisi parameter. Kembalikan objek hasil.\nreturn { ok: true };",
        isEdit: false
    };
}

function fromDetail(detail) {

    const spec = detail.spec ?? {};

    const params = Object.entries(spec.parameters ?? {}).map(([name, p]) => ({
        name,
        type: p.type ?? "string",
        description: p.description ?? "",
        required: Boolean(p.required)
    }));

    return {
        id: detail.id,
        name: detail.manifest?.name ?? detail.id,
        description: spec.description ?? detail.manifest?.description ?? "",
        toolName: spec.toolName ?? "",
        params: params.length ? params : [{ name: "", type: "string", description: "", required: true }],
        code: spec.code ?? "return { ok: true };",
        isEdit: true
    };

}

function openEditor(root) {

    const host = root.querySelector("#st-editor");

    host.style.display = "";

    host.innerHTML = `
        <div class="panel-head">
            <h2>${editing.isEdit ? "Edit tool" : "Tool baru"}</h2>
            <button class="btn ghost sm push" id="ed-close">${icon("x")} Tutup</button>
        </div>

        <div class="grid cols-3" style="gap:10px">
            <div class="field">
                <label>Id plugin</label>
                <input type="text" id="ed-id" value="${esc(editing.id)}"
                    placeholder="ping-host" ${editing.isEdit ? "readonly" : ""}>
            </div>
            <div class="field">
                <label>Nama tampilan</label>
                <input type="text" id="ed-name" value="${esc(editing.name)}" placeholder="Ping Host">
            </div>
            <div class="field">
                <label>Nama fungsi (dipanggil model)</label>
                <input type="text" id="ed-toolname" value="${esc(editing.toolName)}" placeholder="pingHost">
            </div>
        </div>

        <div class="field">
            <label>Deskripsi</label>
            <input type="text" id="ed-desc" value="${esc(editing.description)}"
                placeholder="Apa yang dilakukan tool ini">
        </div>

        <div class="field">
            <label>Parameter</label>
            <div id="ed-params" class="stack" style="gap:6px"></div>
            <button class="btn ghost sm" id="ed-addparam" style="align-self:flex-start;margin-top:6px">
                ${icon("plus")} Parameter
            </button>
        </div>

        <div class="field">
            <label>Kode — badan fungsi execute(context, args)</label>
            <textarea id="ed-code" rows="9" spellcheck="false">${esc(editing.code)}</textarea>
            <span class="help">JavaScript (Node). Boleh require bawaan & fetch. Gunakan <span class="mono">return { ... }</span>.</span>
        </div>

        <div class="row" style="margin-top:8px">
            <button class="btn" id="ed-draft">${icon("check")} Simpan sebagai draft</button>
            <button class="btn primary" id="ed-activate">${icon("play")} Simpan &amp; aktifkan</button>
        </div>`;

    drawParams(host);

    host.querySelector("#ed-close").addEventListener("click", () => {
        host.style.display = "none";
        host.innerHTML = "";
        editing = null;
    });

    host.querySelector("#ed-addparam").addEventListener("click", () => {
        editing.params.push({ name: "", type: "string", description: "", required: false });
        drawParams(host);
    });

    host.querySelector("#ed-draft").addEventListener("click", () => save(root, false));
    host.querySelector("#ed-activate").addEventListener("click", () => save(root, true));

    host.scrollIntoView({ behavior: "smooth", block: "nearest" });

}

function drawParams(host) {

    const list = host.querySelector("#ed-params");

    list.innerHTML = editing.params.map((p, i) => `
        <div class="row" data-param="${i}" style="gap:6px">
            <input type="text" data-p-name value="${esc(p.name)}" placeholder="nama" style="flex:1">
            <select data-p-type style="width:110px">
                ${["string", "number", "boolean"].map(t =>
                    `<option value="${t}" ${t === p.type ? "selected" : ""}>${t}</option>`).join("")}
            </select>
            <input type="text" data-p-desc value="${esc(p.description)}" placeholder="deskripsi" style="flex:1.4">
            <label class="switch" title="wajib"><input type="checkbox" data-p-req ${p.required ? "checked" : ""}><span class="track"></span></label>
            <button class="icon-btn" data-p-del>${icon("x")}</button>
        </div>`).join("");

    list.querySelectorAll("[data-param]").forEach(rowEl => {
        const i = Number(rowEl.dataset.param);
        rowEl.querySelector("[data-p-del]").addEventListener("click", () => {
            editing.params.splice(i, 1);
            if (editing.params.length === 0) {
                editing.params.push({ name: "", type: "string", description: "", required: false });
            }
            drawParams(host);
        });
    });

}

function collect(host) {

    const params = {};

    host.querySelectorAll("[data-param]").forEach(rowEl => {
        const name = rowEl.querySelector("[data-p-name]").value.trim();
        if (!name) return;
        params[name] = {
            type: rowEl.querySelector("[data-p-type]").value,
            description: rowEl.querySelector("[data-p-desc]").value.trim(),
            required: rowEl.querySelector("[data-p-req]").checked
        };
    });

    return {
        id: host.querySelector("#ed-id").value.trim(),
        name: host.querySelector("#ed-name").value.trim(),
        description: host.querySelector("#ed-desc").value.trim(),
        origin: "manual",
        tool: {
            name: host.querySelector("#ed-toolname").value.trim(),
            description: host.querySelector("#ed-desc").value.trim(),
            parameters: params,
            code: host.querySelector("#ed-code").value
        }
    };

}

async function save(root, activate) {

    const host = root.querySelector("#st-editor");

    const body = collect(host);

    if (!body.id || !body.tool.name || !body.tool.code.trim()) {
        toast("Id, nama fungsi, dan kode wajib diisi.", "warn");
        return;
    }

    body.activate = activate;

    try {

        const result = await api.forgeCreate(body);

        toast(
            activate
                ? `Tool '${body.id}' aktif`
                : `Draft '${body.id}' disimpan${result.risks?.length ? ` (${result.risks.length} peringatan risiko)` : ""}`,
            "ok"
        );

        host.style.display = "none";
        host.innerHTML = "";
        editing = null;

        await load(root);

    }

    catch (error) {
        toast(error.message, "danger", 6000);
    }

}
