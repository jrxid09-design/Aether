import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, pill, toast } from "../lib/ui.js";

/**
 * Vision — Aether melihat kamera/CCTV & webcam.
 *
 * Tiga bagian: model vision (mis. llava di Ollama), analisis
 * langsung dari webcam (tangkap frame → analisis), dan kelola
 * kamera/CCTV lewat URL snapshot.
 */

let stream = null;

export const vision = {

    id: "vision",
    label: "Vision",
    icon: "camera",
    title: "Vision",
    subtitle: "Aether melihat — analisis kamera, CCTV, dan webcam.",

    render(root) {

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Vision</h1>
                    <p>Aether melihat — analisis kamera, CCTV, dan webcam.</p>
                </div>
            </div>

            <div class="stack">
                <div class="panel" id="vis-model"></div>

                <div class="grid cols-2">
                    <div class="panel">
                        <div class="panel-head"><h2>${icon("camera")} Webcam</h2></div>
                        <div class="video-frame" id="vis-frame">
                            <div class="placeholder">Tekan "Nyalakan" untuk pratinjau,<br>lalu "Analisis" agar Aether melihat.</div>
                        </div>
                        <div class="row" style="margin-top:10px">
                            <button class="btn sm" id="vis-cam-on">${icon("play")} Nyalakan</button>
                            <button class="btn sm ghost" id="vis-cam-off">${icon("stop")} Matikan</button>
                            <button class="btn primary sm" id="vis-analyze">${icon("orb")} Analisis</button>
                        </div>
                        <input type="text" id="vis-prompt" placeholder="pertanyaan (opsional), mis. ada berapa orang?" style="margin-top:8px">
                        <div id="vis-result" class="quote" style="margin-top:10px;display:none"></div>
                    </div>

                    <div class="panel flush">
                        <div class="panel-head" style="padding:16px 18px 0">
                            <h2>${icon("camera")} Kamera / CCTV</h2>
                        </div>
                        <div id="vis-cameras" style="padding:10px 0 0"></div>
                        <div style="padding:0 16px 16px">
                            <div class="divider"></div>
                            <div class="grid cols-3" style="gap:8px;align-items:end">
                                <div class="field"><label>Id</label><input type="text" id="cam-id" placeholder="dapur"></div>
                                <div class="field"><label>Label</label><input type="text" id="cam-label" placeholder="Dapur"></div>
                                <div class="field"><label>URL snapshot</label><input type="url" id="cam-url" placeholder="http://.../snapshot.jpg"></div>
                            </div>
                            <button class="btn primary sm" id="cam-add" style="margin-top:8px">${icon("plus")} Tambah kamera</button>
                        </div>
                    </div>
                </div>
            </div>`;

    },

    async mount(root) {

        await drawModel(root);
        await drawCameras(root);

        root.querySelector("#vis-cam-on").addEventListener("click", () => startCam(root));
        root.querySelector("#vis-cam-off").addEventListener("click", () => stopCam(root));
        root.querySelector("#vis-analyze").addEventListener("click", () => analyzeWebcam(root));

        root.querySelector("#cam-add").addEventListener("click", async () => {
            const body = {
                id: root.querySelector("#cam-id").value.trim(),
                label: root.querySelector("#cam-label").value.trim(),
                snapshotUrl: root.querySelector("#cam-url").value.trim()
            };
            if (!body.id || !body.snapshotUrl) {
                toast("Id dan URL snapshot wajib diisi.", "warn");
                return;
            }
            try {
                await api.addCamera(body);
                toast("Kamera ditambahkan", "ok");
                await drawCameras(root);
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });

    },

    unmount() {
        stopCam();
    }

};

async function drawModel(root) {

    const host = root.querySelector("#vis-model");

    try {
        const cfg = await api.visionConfig();

        host.innerHTML = `
            <div class="panel-head">
                <h2>${icon("orb")} Model vision</h2>
                <span class="push">${pill(
                    cfg.configured ? (cfg.effective ?? "aktif") : "belum diatur",
                    cfg.configured ? "ok" : "idle"
                )}</span>
            </div>
            <div class="row">
                <input type="text" id="vis-model-input" value="${esc(cfg.model ?? "")}"
                    placeholder="mis. llava atau qwen2-vl (Ollama), atau model vision cloud" style="flex:1">
                <button class="btn primary sm" id="vis-model-save">${icon("check")} Simpan</button>
            </div>
            <div class="small muted" style="margin-top:8px">
                Butuh model yang bisa melihat. Di Ollama: <span class="mono">ollama pull llava</span>.
                Kalau kosong &amp; provider Ollama, otomatis pakai <span class="mono">llava</span>.
            </div>`;

        host.querySelector("#vis-model-save").addEventListener("click", async () => {
            try {
                await api.saveVisionConfig({ model: host.querySelector("#vis-model-input").value.trim() });
                toast("Model vision disimpan", "ok");
                await drawModel(root);
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });

    }
    catch (error) {
        host.innerHTML = `<div class="small danger-text">${esc(error.message)}</div>`;
    }

}

async function drawCameras(root) {

    const host = root.querySelector("#vis-cameras");

    try {
        const { cameras } = await api.cameras();

        if (cameras.length === 0) {
            host.innerHTML = `<div class="empty" style="padding:20px">${icon("camera")}<div>Belum ada kamera.</div></div>`;
            return;
        }

        host.innerHTML = cameras.map(c => `
            <div class="list-item" data-cam="${esc(c.id)}">
                <div style="min-width:0;flex:1">
                    <div class="title">${esc(c.label)} <span class="tag mono">${esc(c.id)}</span></div>
                    <div class="sub mono truncate" style="max-width:260px">${esc(c.snapshotUrl)}</div>
                </div>
                <button class="btn sm" data-see>${icon("orb")} Lihat</button>
                <button class="btn sm danger" data-del>${icon("trash")}</button>
                <div class="quote" data-out style="flex-basis:100%;margin-top:8px;display:none"></div>
            </div>`).join("");

        host.querySelectorAll("[data-cam]").forEach(row => {
            const id = row.dataset.cam;
            row.querySelector("[data-see]").addEventListener("click", async () => {
                const out = row.querySelector("[data-out]");
                out.style.display = "block";
                out.innerHTML = `<span class="spinner"></span> <span class="muted">Aether sedang melihat…</span>`;
                try {
                    const r = await api.seeCamera(id);
                    out.innerHTML = `<div class="small">${esc(r.text)}</div><div class="small dim mono" style="margin-top:4px">${esc(r.model)}</div>`;
                }
                catch (error) {
                    out.innerHTML = `<span class="danger-text">${esc(error.message)}</span>`;
                }
            });
            row.querySelector("[data-del]").addEventListener("click", async () => {
                if (!window.confirm(`Hapus kamera '${id}'?`)) return;
                try {
                    await api.removeCamera(id);
                    await drawCameras(root);
                }
                catch (error) {
                    toast(error.message, "danger");
                }
            });
        });

    }
    catch (error) {
        host.innerHTML = `<div class="small danger-text" style="padding:16px">${esc(error.message)}</div>`;
    }

}

async function startCam(root) {

    stopCam();

    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    catch (error) {
        toast(`Kamera: ${error.message}`, "danger");
        return;
    }

    const frame = root.querySelector("#vis-frame");
    frame.innerHTML = "";
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    frame.appendChild(video);

}

function stopCam(root) {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    if (root) {
        const frame = root.querySelector("#vis-frame");
        if (frame) {
            frame.innerHTML = `<div class="placeholder">Tekan "Nyalakan" untuk pratinjau,<br>lalu "Analisis" agar Aether melihat.</div>`;
        }
    }
}

async function analyzeWebcam(root) {

    const video = root.querySelector("#vis-frame video");

    if (!video) {
        toast("Nyalakan kamera dulu.", "warn");
        return;
    }

    // Tangkap frame ke canvas → JPEG base64.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

    const out = root.querySelector("#vis-result");
    out.style.display = "block";
    out.innerHTML = `<span class="spinner"></span> <span class="muted">Aether sedang melihat…</span>`;

    try {
        const r = await api.visionAnalyze({
            image: base64,
            mimeType: "image/jpeg",
            prompt: root.querySelector("#vis-prompt").value.trim() || undefined
        });
        out.innerHTML = `<div class="small selectable">${esc(r.text)}</div><div class="small dim mono" style="margin-top:4px">${esc(r.model)}</div>`;
    }
    catch (error) {
        out.innerHTML = `<span class="danger-text">${esc(error.message)}</span>`;
    }

}
