import { store } from "../lib/store.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, pill, toast } from "../lib/ui.js";

export const settings = {

    id: "settings",
    label: "Settings",
    icon: "settings",
    title: "Settings",
    subtitle: "Koneksi ke daemon dan kendali proses lokal.",

    render(root) {

        const s = store.get().settings;

        const local = store.get().localDaemon;

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Settings</h1>
                    <p>Koneksi ke daemon dan kendali proses lokal.</p>
                </div>
            </div>

            <div class="grid cols-2">

                <div class="panel">
                    <div class="panel-head"><h2>${icon("plug")} Koneksi daemon</h2></div>

                    <div class="stack">

                        <div class="field">
                            <label>Alamat daemon</label>
                            <input type="url" id="set-url" value="${esc(s.daemonUrl)}"
                                placeholder="http://192.168.1.10:3000">
                            <span class="help">
                                Pakai <span class="mono">localhost</span> bila daemon jalan di perangkat ini,
                                atau IP LAN PC rumah bila memantau dari laptop.
                            </span>
                        </div>

                        <div class="field">
                            <label>Token akses</label>
                            <input type="password" id="set-token" value="${esc(s.token)}"
                                placeholder="kosongkan bila AETHER_TOKEN tidak diset">
                            <span class="help">
                                Harus sama dengan <span class="mono">AETHER_TOKEN</span> di
                                <span class="mono">.env</span> daemon. Tanpa token, siapa pun
                                di jaringan yang sama bisa mengakses API.
                            </span>
                        </div>

                        <div class="field">
                            <label>Interval polling</label>
                            <select id="set-poll">
                                ${[2000, 5000, 10000, 30000].map(ms => `
                                    <option value="${ms}" ${ms === s.pollInterval ? "selected" : ""}>
                                        ${ms / 1000} detik
                                    </option>`).join("")}
                            </select>
                        </div>

                        <label class="switch">
                            <input type="checkbox" id="set-auto" ${s.autoConnect ? "checked" : ""}>
                            <span class="track"></span>
                            <span>Sambung otomatis saat Console dibuka</span>
                        </label>

                        <div class="row">
                            <button class="btn primary" id="set-save">${icon("check")} Simpan &amp; sambungkan</button>
                        </div>

                    </div>
                </div>

                <div class="stack">

                    <div class="panel">
                        <div class="panel-head">
                            <h2>${icon("server")} Daemon lokal</h2>
                            <span class="hint push" id="local-state">
                                ${local.running ? `berjalan (pid ${local.pid})` : "berhenti"}
                            </span>
                        </div>

                        <div class="small muted" style="margin-bottom:10px">
                            Menjalankan <span class="mono">src/server.js</span> dari repo ini sebagai
                            proses anak. Berguna saat mengembangkan di laptop; di PC rumah
                            sebaiknya daemon dijalankan sebagai service tersendiri.
                        </div>

                        <div class="row">
                            <button class="btn" id="local-start">${icon("play")} Jalankan</button>
                            <button class="btn ghost" id="local-stop">${icon("stop")} Hentikan</button>
                        </div>

                        <div class="divider"></div>

                        <div class="small dim mono selectable" id="local-path">—</div>
                    </div>

                    <div class="panel">
                        <div class="panel-head"><h2>${icon("alert")} Catatan keamanan</h2></div>
                        <div class="small muted stack" style="gap:8px">
                            <p style="margin:0">
                                Daemon mendengarkan di <span class="mono">0.0.0.0</span>, jadi begitu
                                dijalankan di PC rumah ia terjangkau seluruh perangkat pada LAN yang sama.
                            </p>
                            <p style="margin:0">
                                Set <span class="mono selectable">AETHER_TOKEN</span> di berkas
                                <span class="mono">.env</span> PC tersebut, lalu isikan token yang sama
                                di kolom di samping. Tanpa itu, endpoint chat, eksekusi tool, dan
                                filesystem terbuka tanpa autentikasi.
                            </p>
                        </div>
                    </div>

                </div>

            </div>

            <div id="set-daemon-config" class="stack" style="margin-top:14px"></div>`;

    },

    async mount(root) {

        const status = await window.aether.daemon.status();

        root.querySelector("#local-path").textContent = status.entry;

        const updateLocal = (running, pid) => {

            store.patch("localDaemon", { running, pid: pid ?? null });

            root.querySelector("#local-state").textContent =
                running ? `berjalan (pid ${pid})` : "berhenti";

        };

        updateLocal(status.running, status.pid);

        root.querySelector("#set-save").addEventListener("click", async () => {

            const patch = {
                daemonUrl: root.querySelector("#set-url").value.trim(),
                token: root.querySelector("#set-token").value,
                pollInterval: Number(root.querySelector("#set-poll").value),
                autoConnect: root.querySelector("#set-auto").checked
            };

            const saved = await window.aether.settings.set(patch);

            store.set({ settings: saved });

            toast("Pengaturan disimpan", "ok");

            document.dispatchEvent(new CustomEvent("aether:reconnect"));

        });

        root.querySelector("#local-start").addEventListener("click", async () => {

            const result = await window.aether.daemon.start();

            if (result.error) {
                toast(result.error, "danger");
                return;
            }

            // Daemon lain sudah hidup di alamat ini — Console tidak
            // menjalankan proses kedua, cukup menyambung.
            if (result.external) {

                updateLocal(false, null);

                toast("Daemon sudah berjalan di alamat ini — menyambungkan…", "ok");

                document.dispatchEvent(new CustomEvent("aether:reconnect"));

                return;

            }

            updateLocal(true, result.pid);

            toast(
                result.alreadyRunning
                    ? "Daemon lokal sudah berjalan"
                    : `Daemon lokal dijalankan (pid ${result.pid})`,
                "ok"
            );

            // Beri jeda agar server sempat listen sebelum disambung.
            setTimeout(
                () => document.dispatchEvent(new CustomEvent("aether:reconnect")),
                1800
            );

        });

        root.querySelector("#local-stop").addEventListener("click", async () => {

            await window.aether.daemon.stop();

            updateLocal(false, null);

            toast("Daemon lokal dihentikan", "warn");

        });

        // Panel konfigurasi daemon (AI provider + Telegram) butuh
        // koneksi; muat setelah panel dasar siap.
        await renderDaemonConfig(root);

    }

};

/**
 * Panel yang mengonfigurasi DAEMON (bukan Console): platform AI +
 * API key, dan Telegram. Hanya bisa dimuat saat terhubung.
 */
async function renderDaemonConfig(root) {

    const host = root.querySelector("#set-daemon-config");

    if (!store.get().connected) {
        host.innerHTML = `
            <div class="panel"><div class="small dim">
                ${icon("plug")} Sambungkan ke daemon dulu untuk mengatur provider AI &amp; Telegram.
            </div></div>`;
        return;
    }

    host.innerHTML = `<div class="panel"><div class="row">
        <span class="spinner"></span><span class="small muted">Memuat konfigurasi…</span>
    </div></div>`;

    try {

        const [aiCfg, tg, voice, homeCfg] = await Promise.all([
            api.request("/ai/config"),
            api.request("/telegram/status"),
            api.voiceConfig(),
            api.homeStatus().catch(() => null)
        ]);

        host.innerHTML = aiPanel(aiCfg) + voicePanel(voice)
            + homePanel(homeCfg) + telegramPanel(tg);

        wireAiPanel(root, aiCfg);
        wireVoicePanel(root);
        wireHomePanel(root);
        wireTelegramPanel(root);

    }

    catch (error) {
        host.innerHTML = `<div class="panel"><div class="empty">${icon("alert")}
            <div class="danger-text">${esc(error.message)}</div></div></div>`;
    }

}

function aiPanel(cfg) {

    const ids = Object.keys(cfg.providers);

    const fellBack = cfg.resolved.fellBackFrom;

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("cpu")} Provider AI</h2>
                <span class="push">${pill(
                    `aktif: ${cfg.resolved.label}`,
                    cfg.resolved.kind === "ollama" ? "warn" : "ok"
                )}</span>
            </div>

            <div class="small muted" style="margin-bottom:10px">
                Isi API key dari platform mana pun. <strong>Key terisi → Aether pakai
                platform itu. Key kosong → otomatis Ollama lokal.</strong>
                ${fellBack ? `<span class="warn-text"> (key ${esc(fellBack)} kosong, sekarang pakai Ollama)</span>` : ""}
            </div>

            <div class="field">
                <label>Platform aktif</label>
                <select id="ai-active">
                    ${ids.map(id => `<option value="${id}" ${cfg.active === id ? "selected" : ""}>${esc(cfg.providers[id].label)}</option>`).join("")}
                    <option value="ollama" ${cfg.active === "ollama" ? "selected" : ""}>${esc(cfg.ollama.label)}</option>
                </select>
            </div>

            <div id="ai-provider-fields"></div>

            <div class="row" style="margin-top:10px">
                <button class="btn primary" id="ai-save">${icon("check")} Simpan &amp; terapkan</button>
                <span class="small dim">perubahan langsung dipakai tanpa restart</span>
            </div>
        </div>`;

}

function voicePanel(v) {

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("mic")} Suara (STT &amp; TTS)</h2>
                <span class="push">${pill(
                    v.tts.configured ? "TTS neural" : "suara OS",
                    v.tts.configured ? "ok" : "idle"
                )}</span>
            </div>

            <div class="small muted" style="margin-bottom:10px">
                <strong>Suara masuk (STT):</strong> endpoint transcribe kompatibel-OpenAI
                (mis. faster-whisper-server) agar mic bisa mengetik ucapan.<br>
                <strong>Suara keluar (TTS):</strong> endpoint /v1/audio/speech
                (mis. <span class="mono">Kokoro-FastAPI</span>) untuk banyak suara &amp;
                bahasa Indonesia. Kosong → pakai suara OS.
            </div>

            <div class="divider" style="margin:6px 0"></div>
            <div class="small dim" style="margin-bottom:6px">Suara masuk — STT</div>
            <div class="grid cols-3" style="gap:10px">
                <div class="field"><label>Endpoint</label>
                    <input type="url" id="stt-url" value="${esc(v.stt.url)}"
                        placeholder="http://localhost:8000/v1/audio/transcriptions"></div>
                <div class="field"><label>Model</label>
                    <input type="text" id="stt-model" value="${esc(v.stt.model)}"
                        placeholder="Systran/faster-whisper-base"></div>
                <div class="field"><label>API key ${v.stt.hasKey ? `<span class="dim">(${esc(v.stt.keyHint)})</span>` : ""}</label>
                    <input type="password" id="stt-key" placeholder="opsional"></div>
            </div>

            <div class="divider" style="margin:12px 0 6px"></div>
            <div class="small dim" style="margin-bottom:6px">Suara keluar — TTS neural</div>
            <div class="grid cols-4" style="gap:10px">
                <div class="field" style="grid-column:span 2"><label>Endpoint</label>
                    <input type="url" id="tts-url" value="${esc(v.tts.url)}"
                        placeholder="http://localhost:8880/v1/audio/speech"></div>
                <div class="field"><label>Model</label>
                    <input type="text" id="tts-model" value="${esc(v.tts.model)}" placeholder="kokoro"></div>
                <div class="field"><label>Voice</label>
                    <input type="text" id="tts-voice" value="${esc(v.tts.voice)}" placeholder="af_heart / id_..."></div>
                <div class="field" style="grid-column:span 2"><label>API key ${v.tts.hasKey ? `<span class="dim">(${esc(v.tts.keyHint)})</span>` : ""}</label>
                    <input type="password" id="tts-key" placeholder="opsional"></div>
            </div>

            <div class="row" style="margin-top:10px">
                <button class="btn primary" id="voice-save">${icon("check")} Simpan suara</button>
                <span class="small dim">efek robot diatur di layar Aether</span>
            </div>
        </div>`;

}

function wireVoicePanel(root) {

    root.querySelector("#voice-save").addEventListener("click", async () => {

        const val = id => root.querySelector(id).value.trim();

        const body = {
            stt: { url: val("#stt-url"), model: val("#stt-model") },
            tts: { url: val("#tts-url"), model: val("#tts-model"), voice: val("#tts-voice") }
        };

        // Hanya kirim key bila diisi (biar tak menimpa yang tersimpan).
        const sttKey = root.querySelector("#stt-key").value;
        const ttsKey = root.querySelector("#tts-key").value;
        if (sttKey) body.stt.key = sttKey;
        if (ttsKey) body.tts.key = ttsKey;

        try {
            await api.saveVoiceConfig(body);
            toast("Konfigurasi suara disimpan", "ok");
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }

    });

}

function homePanel(h) {

    const online = h?.health?.online;

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("home")} Rumah (Home Assistant)</h2>
                <span class="push">${pill(
                    !h?.configured ? "belum diatur" : (online ? "tersambung" : "offline"),
                    !h?.configured ? "idle" : (online ? "ok" : "danger")
                )}</span>
            </div>

            <div class="small muted" style="margin-bottom:10px">
                Sambungkan ke Home Assistant untuk mengendalikan lampu, AC, saklar,
                Sonoff, Zigbee, dll. Token = <em>long-lived access token</em> dari
                profil HA-mu. Disimpan lokal (gitignored).
            </div>

            <div class="grid cols-2" style="gap:10px">
                <div class="field">
                    <label>URL Home Assistant</label>
                    <input type="url" id="ha-url" value="${esc(h?.url ?? "")}"
                        placeholder="http://192.168.1.10:8123">
                </div>
                <div class="field">
                    <label>Token ${h?.hasToken ? `<span class="dim">(${esc(h.tokenHint)})</span>` : ""}</label>
                    <input type="password" id="ha-token" placeholder="${h?.hasToken ? "isi untuk mengganti" : "long-lived access token"}">
                </div>
            </div>
            ${h?.health?.error && h?.configured ? `<div class="small danger-text" style="margin-top:6px">${esc(h.health.error)}</div>` : ""}
            <div class="row" style="margin-top:10px">
                <button class="btn primary" id="ha-save">${icon("check")} Simpan &amp; sambungkan</button>
            </div>
        </div>`;

}

function wireHomePanel(root) {

    const btn = root.querySelector("#ha-save");
    if (!btn) return;

    btn.addEventListener("click", async () => {

        const body = { url: root.querySelector("#ha-url").value.trim() };
        const token = root.querySelector("#ha-token").value.trim();
        if (token) body.token = token;

        try {
            await api.saveHomeConfig(body);
            const status = await api.homeStatus();
            toast(
                status.health?.online ? "Home Assistant tersambung ✅"
                    : (status.health?.error ?? "Tersimpan"),
                status.health?.online ? "ok" : "warn",
                5000
            );
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }

    });

}

function telegramPanel(tg) {

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("send")} Telegram</h2>
                <span class="push">${pill(
                    tg.running ? `@${tg.username}` : (tg.hasToken ? "tidak aktif" : "belum diatur"),
                    tg.running ? "ok" : (tg.hasToken ? "danger" : "idle")
                )}</span>
            </div>

            <div class="stack">
                <div class="field">
                    <label>Bot token</label>
                    <input type="password" id="tg-token" placeholder="${tg.hasToken ? esc(tg.tokenHint) + " (tersimpan — isi untuk ganti)" : "dari @BotFather"}">
                    <span class="help">Dari @BotFather. Disimpan lokal di daemon (gitignored).</span>
                </div>
                <div class="field">
                    <label>Chat id yang diizinkan</label>
                    <input type="text" id="tg-allowed" value="${esc((tg.allowed ?? []).join(", "))}"
                        placeholder="mis. 123456789, 987654321">
                    <span class="help">Kirim <span class="mono">/id</span> ke bot untuk tahu chat id-mu. Pisahkan koma. Tanpa ini bot menolak semua.</span>
                </div>
                ${tg.lastError ? `<div class="small danger-text">${esc(tg.lastError)}</div>` : ""}
                <div class="row">
                    <button class="btn primary" id="tg-save">${icon("check")} Simpan &amp; jalankan</button>
                    <button class="btn ghost" id="tg-test" ${tg.running ? "" : "disabled"}>${icon("send")} Kirim uji</button>
                </div>
            </div>
        </div>`;

}

function providerFields(cfg, id) {

    if (id === "ollama") {
        return `
            <div class="grid cols-2" style="gap:10px">
                <div class="field">
                    <label>Base URL</label>
                    <input type="url" id="ai-baseurl" value="${esc(cfg.ollama.baseUrl)}" placeholder="http://localhost:11434">
                </div>
                <div class="field">
                    <label>Model</label>
                    <input type="text" id="ai-model" value="${esc(cfg.ollama.model ?? "")}" placeholder="${esc(cfg.ollama.modelHint)}">
                </div>
            </div>`;
    }

    const p = cfg.providers[id];

    return `
        <div class="field">
            <label>API key ${p.hasKey ? `<span class="dim">(tersimpan: ${esc(p.keyHint)})</span>` : ""}</label>
            <input type="password" id="ai-key" placeholder="${p.hasKey ? "isi untuk mengganti, kosongkan untuk pakai Ollama" : "tempel API key di sini"}">
            <span class="help">Kosongkan &amp; simpan untuk menghapus key (Aether balik ke Ollama).</span>
        </div>
        <div class="grid cols-2" style="gap:10px">
            <div class="field">
                <label>Base URL</label>
                <input type="url" id="ai-baseurl" value="${esc(p.baseUrl)}" placeholder="${esc(p.defaultBaseUrl)}">
            </div>
            <div class="field">
                <label>Model</label>
                <input type="text" id="ai-model" value="${esc(p.model ?? "")}" placeholder="${esc(p.modelHint)}">
            </div>
        </div>`;

}

function wireAiPanel(root, cfg) {

    const select = root.querySelector("#ai-active");
    const fields = root.querySelector("#ai-provider-fields");

    const draw = () => { fields.innerHTML = providerFields(cfg, select.value); };

    draw();
    select.addEventListener("change", draw);

    root.querySelector("#ai-save").addEventListener("click", async () => {

        const id = select.value;

        const body = { active: id };

        if (id === "ollama") {
            body.ollama = {
                baseUrl: root.querySelector("#ai-baseurl").value.trim(),
                model: root.querySelector("#ai-model").value.trim()
            };
        }
        else {
            const key = root.querySelector("#ai-key").value;
            body.provider = {
                id,
                // Hanya kirim key bila diisi (biar tidak menimpa
                // yang tersimpan dengan string kosong tak sengaja)…
                ...(key !== "" ? { apiKey: key } : {}),
                baseUrl: root.querySelector("#ai-baseurl").value.trim(),
                model: root.querySelector("#ai-model").value.trim()
            };
        }

        try {
            const result = await api.request("/ai/config", { method: "POST", body });
            toast(`AI aktif: ${result.reconfigured.platform}`, "ok");
            await renderDaemonConfig(root);
            // Segarkan info provider di store agar view lain ikut update.
            document.dispatchEvent(new CustomEvent("aether:reconnect"));
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }

    });

}

function wireTelegramPanel(root) {

    root.querySelector("#tg-save").addEventListener("click", async () => {

        const token = root.querySelector("#tg-token").value.trim();
        const allowed = root.querySelector("#tg-allowed").value.trim();

        const body = { allowed };
        if (token) {
            body.token = token;
        }

        try {
            const status = await api.request("/telegram/config", { method: "POST", body });
            toast(
                status.running ? `Bot @${status.username} aktif` : (status.lastError ?? "Tersimpan"),
                status.running ? "ok" : "warn",
                5000
            );
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }

    });

    const testBtn = root.querySelector("#tg-test");
    if (testBtn) {
        testBtn.addEventListener("click", async () => {
            try {
                const r = await api.request("/telegram/test", { method: "POST", body: {} });
                toast(`Terkirim ke ${r.recipients} chat`, "ok");
            }
            catch (error) {
                toast(error.message, "danger");
            }
        });
    }

}
