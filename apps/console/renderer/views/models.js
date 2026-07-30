import { store } from "../lib/store.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, bytes, relativeTime, pill, toast } from "../lib/ui.js";

export const models = {

    id: "models",
    label: "Models",
    icon: "cpu",
    title: "Models",
    subtitle: "Model yang tersedia pada tiap provider.",

    render(root) {

        const o = store.get().overview;

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Models</h1>
                    <p>Model yang tersedia pada tiap provider AI.</p>
                </div>
                <div class="actions">
                    <select id="model-provider" style="width:170px">
                        ${(o?.ai.providers ?? []).map(provider => `
                            <option value="${esc(provider.id)}" ${provider.id === o?.ai.active ? "selected" : ""}>
                                ${esc(provider.id)}
                            </option>`).join("")}
                    </select>
                    <button class="btn ghost sm" id="model-refresh">${icon("refresh")} Muat ulang</button>
                </div>
            </div>

            <div class="panel flush">
                <div id="model-body" style="padding:16px">
                    <div class="row"><span class="spinner"></span><span class="small muted">Memuat model…</span></div>
                </div>
            </div>`;

    },

    async mount(root) {

        const select = root.querySelector("#model-provider");
        const body = root.querySelector("#model-body");

        const load = async () => {

            body.innerHTML = `<div class="row"><span class="spinner"></span><span class="small muted">Memuat model…</span></div>`;

            try {

                const data = await api.models(select.value);

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

        select.addEventListener("change", load);

        root.querySelector("#model-refresh").addEventListener("click", load);

        await load();

    }

};

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
