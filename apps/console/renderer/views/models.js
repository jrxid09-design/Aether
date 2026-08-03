import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, bytes, relativeTime, pill, toast } from "../lib/ui.js";
import { aiChoices } from "../lib/aiselect.js";

export const models = {

    id: "models",
    label: "Models",
    icon: "cpu",
    title: "Models",
    subtitle: "Model yang tersedia pada AI yang dipakai Aether.",

    render(root) {

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Models</h1>
                    <p>Model yang tersedia pada AI yang sedang dipakai Aether.</p>
                </div>
                <div class="actions">
                    <div class="seg" id="model-mode" style="margin:0"></div>
                    <button class="btn ghost sm" id="model-refresh">${icon("refresh")} Muat ulang</button>
                </div>
            </div>

            <div class="panel flush">
                <div id="model-body" style="padding:16px">
                    <div class="row"><span class="spinner"></span><span class="small muted">Memuat model…</span></div>
                </div>
            </div>

            <div class="panel" style="margin-top:14px">
                <div class="panel-head"><h2>${icon("activity")} Pemakaian AI Harian</h2>
                    <span class="hint push" id="usage-sum">—</span></div>
                <div id="usage-body"><div class="row"><span class="spinner"></span><span class="small muted">Memuat pemakaian…</span></div></div>
            </div>`;

    },

    async mount(root) {

        const seg = root.querySelector("#model-mode");
        const body = root.querySelector("#model-body");

        // Selektor "AI Lokal / AI Provider" — ganti otak Aether langsung.
        await aiChoices.render(seg, () => load());

        const load = async () => {

            body.innerHTML = `<div class="row"><span class="spinner"></span><span class="small muted">Memuat model…</span></div>`;

            try {

                const data = await api.models();

                body.innerHTML = table(data);

                body.querySelectorAll("[data-set-model]").forEach(button => {

                    button.addEventListener("click", async () => {

                        try {
                            await api.selectModel(button.dataset.setModel);
                            toast(`Model default: ${button.dataset.setModel}`, "ok");
                            load();
                        }
                        catch (error) {
                            toast(error.message, "danger");
                        }

                    });

                });

            }

            catch (error) {

                body.innerHTML = `<div class="empty">${icon("alert")}<div class="danger-text">${esc(error.message)}</div></div>`;

            }

        };

        root.querySelector("#model-refresh").addEventListener("click", () => { load(); loadUsage(root); });

        await load();
        loadUsage(root);

    }

};

async function loadUsage(root) {
    const body = root.querySelector("#usage-body");
    const sum = root.querySelector("#usage-sum");
    if (!body) return;
    try {
        const u = await api.aiUsage(14);
        const hist = u.history ?? [];
        const today = u.today ?? {};
        const provs = Object.entries(today);
        const reqToday = provs.reduce((a, [, p]) => a + (p.requests || 0), 0);
        if (sum) sum.textContent = `${reqToday} request hari ini`;

        body.innerHTML = `
            ${usageBars(hist)}
            <div class="divider"></div>
            ${provs.length
                ? `<div class="scroll-x"><table class="table">
                    <thead><tr><th>Provider</th><th>Request</th><th>Token</th><th>Status</th></tr></thead>
                    <tbody>${provs.map(([name, p]) => `<tr>
                        <td>${esc(name)}</td>
                        <td class="mono small">${p.requests || 0}</td>
                        <td class="mono small">${(p.promptTokens || 0) + (p.completionTokens || 0)}</td>
                        <td>${p.limited ? pill("limit habis", "danger") : (p.warned ? pill("mendekati", "warn") : pill("ok", "ok"))}</td>
                    </tr>`).join("")}</tbody></table></div>`
                : `<div class="small dim">Belum ada pemakaian hari ini.</div>`}`;
    }
    catch (error) {
        body.innerHTML = `<div class="small dim">Pemakaian tak tersedia: ${esc(error.message)}</div>`;
    }
}

function usageBars(hist) {
    if (!hist.length) return `<div class="small dim">Belum ada data.</div>`;
    const max = Math.max(1, ...hist.map(d => d.totalRequests));
    return `<div class="usage-bars">${hist.map(d => {
        const h = Math.round((d.totalRequests / max) * 100);
        return `<div class="ub" title="${esc(d.date)}: ${d.totalRequests} request, ${d.totalTokens} token">
            <div class="ub-fill" style="height:${Math.max(3, h)}%"></div>
            <div class="ub-x">${esc(d.date.slice(5))}</div>
        </div>`;
    }).join("")}</div>`;
}

function table(data) {

    const list = data.models ?? [];

    if (list.length === 0) {

        return `<div class="empty">
            ${icon("cpu")}
            <div style="font-size:14px;color:var(--text)">Tidak ada model</div>
            <div>Untuk Ollama, unduh dulu lewat <span class="mono">ollama pull &lt;model&gt;</span> di mesin tempat Ollama berjalan.</div>
        </div>`;

    }

    // Kolom yang ditampilkan menyesuaikan provider: Ollama punya
    // ukuran & kuantisasi, OpenRouter punya panjang konteks.
    const isLocal = list.some(model => model.size != null);

    return `<div class="scroll-x"><table class="table">
        <thead>
            <tr>
                <th>Model</th>
                ${isLocal
                    ? `<th>Keluarga</th><th>Parameter</th><th>Kuantisasi</th><th>Ukuran</th><th>Diperbarui</th>`
                    : `<th>Konteks</th><th>Harga prompt</th><th>Harga output</th>`}
                <th style="width:1%"></th>
            </tr>
        </thead>
        <tbody>
            ${list.map(model => {

                const isDefault = model.id === data.defaultModel;

                return `<tr>
                    <td>
                        <div class="row" style="gap:8px">
                            <span class="mono">${esc(model.name ?? model.id)}</span>
                            ${model.status === "verified" ? pill("✓ verified", "ok") : ""}
                            ${model.tier && model.tier !== "stable" ? pill(model.tier, "warn") : ""}
                            ${model.free ? pill("free", "ok") : ""}
                            ${isDefault ? pill("default", "ok") : ""}
                        </div>
                    </td>
                    ${isLocal
                        ? `<td class="small muted">${esc(model.family ?? "—")}</td>
                           <td class="small mono">${esc(model.parameterSize ?? "—")}</td>
                           <td class="small mono">${esc(model.quantization ?? "—")}</td>
                           <td class="small mono">${bytes(model.size)}</td>
                           <td class="small dim">${relativeTime(model.modifiedAt)}</td>`
                        : `<td class="small mono">${model.contextLength ? Number(model.contextLength).toLocaleString("id-ID") : "—"}</td>
                           <td class="small mono">${esc(model.pricing?.prompt ?? "—")}</td>
                           <td class="small mono">${esc(model.pricing?.completion ?? "—")}</td>`}
                    <td>
                        <button class="btn sm ghost" data-set-model="${esc(model.id)}" ${isDefault ? "disabled" : ""}>
                            ${isDefault ? "Aktif" : "Jadikan default"}
                        </button>
                    </td>
                </tr>`;

            }).join("")}
        </tbody>
    </table></div>`;

}
