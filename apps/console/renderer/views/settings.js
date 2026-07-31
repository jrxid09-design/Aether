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

        const [aiCfg, tg, voice, homeCfg, people, auto] = await Promise.all([
            api.request("/ai/config"),
            api.request("/whatsapp/status"),
            api.voiceConfig(),
            api.homeStatus().catch(() => null),
            api.request("/people/status").catch(() => null),
            api.request("/automation/status").catch(() => null)
        ]);

        host.innerHTML = aiPanel(aiCfg) + voicePanel(voice)
            + homePanel(homeCfg) + peoplePanel(people) + whatsappPanel(tg)
            + automationPanel(auto);

        wireAiPanel(root, aiCfg);
        wireVoicePanel(root);
        wireHomePanel(root);
        wirePeoplePanel(root);
        wireWhatsappPanel(root);
        wireAutomationPanel(root);

    }

    catch (error) {
        host.innerHTML = `<div class="panel"><div class="empty">${icon("alert")}
            <div class="danger-text">${esc(error.message)}</div></div></div>`;
    }

}

function aiPanel(cfg) {

    const isLocal = cfg.active === "ollama";

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

            <div class="small muted" style="margin-bottom:6px">
                Pilih otak Aether: <strong>AI Lokal</strong> (Ollama — gratis, privat,
                jalan di mesin sendiri) atau <strong>AI Provider</strong> (cloud pakai
                API key). Kosongkan key &amp; simpan untuk balik ke AI Lokal.
                ${fellBack ? `<span class="warn-text"> (key ${esc(fellBack)} kosong, sekarang pakai AI Lokal)</span>` : ""}
            </div>

            <div class="seg" id="ai-mode">
                <button type="button" data-mode="ollama" class="${isLocal ? "active" : ""}">
                    ${icon("server")} AI Lokal</button>
                <button type="button" data-mode="provider" class="${isLocal ? "" : "active"}">
                    ${icon("cloud")} AI Provider</button>
            </div>

            <div id="ai-provider-fields"></div>

            <div class="row" style="margin-top:10px">
                <button class="btn primary" id="ai-save">${icon("check")} Simpan &amp; terapkan</button>
                <span class="small dim">langsung dipakai tanpa restart</span>
            </div>
        </div>`;

}

/** Kolom Model: dropdown terisi lewat "Muat", dengan opsi ketik manual. */
function modelField(currentModel) {

    return `
        <div class="field">
            <label>Model</label>
            <div class="row" style="gap:6px">
                <select id="ai-model" style="flex:1">
                    <option value="">— pilih model —</option>
                    ${currentModel ? `<option value="${esc(currentModel)}" selected>${esc(currentModel)}</option>` : ""}
                    <option value="__manual__">✎ ketik manual…</option>
                </select>
                <button type="button" class="btn ghost sm" id="ai-load-models">${icon("refresh")} Muat</button>
            </div>
            <input type="text" id="ai-model-manual" style="display:none;margin-top:6px"
                value="${esc(currentModel ?? "")}" placeholder="nama model, mis. gpt-4o-mini">
            <span class="help" id="ai-model-help">Tekan <strong>Muat</strong> untuk mengambil daftar model dari provider (butuh key valid).</span>
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

function peoplePanel(p) {

    const im = p?.immich ?? {};
    const fc = p?.face ?? {};
    const online = im.health?.online;

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("camera")} Orang &amp; Wajah</h2>
                <span class="push">${pill(
                    !im.configured ? "Immich belum diatur" : (online ? "Immich tersambung" : "Immich offline"),
                    !im.configured ? "idle" : (online ? "ok" : "danger")
                )}</span>
            </div>

            <div class="small muted" style="margin-bottom:10px">
                <strong>Immich</strong> = galeri + pengenalan wajah bawaan: cari foto
                ("foto ibu", "saat ke Bandung"). <strong>Layanan wajah</strong> (CompreFace)
                = kenali siapa di CCTV secara langsung. Keduanya opsional.
            </div>

            <div class="small dim" style="margin-bottom:6px">Immich</div>
            <div class="grid cols-2" style="gap:10px">
                <div class="field"><label>URL Immich</label>
                    <input type="url" id="im-url" value="${esc(im.url ?? "")}" placeholder="http://192.168.1.10:2283"></div>
                <div class="field"><label>API key ${im.hasKey ? `<span class="dim">(${esc(im.keyHint)})</span>` : ""}</label>
                    <input type="password" id="im-key" placeholder="${im.hasKey ? "isi untuk ganti" : "API key Immich"}"></div>
            </div>
            <div class="row" style="margin-top:8px">
                <button class="btn primary sm" id="im-save">${icon("check")} Simpan Immich</button>
            </div>

            <div class="divider" style="margin:12px 0 6px"></div>
            <div class="small dim" style="margin-bottom:6px">Layanan wajah (CompreFace-compatible) — untuk CCTV</div>
            <div class="grid cols-2" style="gap:10px">
                <div class="field"><label>URL</label>
                    <input type="url" id="fc-url" value="${esc(fc.url ?? "")}" placeholder="http://localhost:8000"></div>
                <div class="field"><label>API key ${fc.hasKey ? `<span class="dim">(${esc(fc.keyHint)})</span>` : ""}</label>
                    <input type="password" id="fc-key" placeholder="${fc.hasKey ? "isi untuk ganti" : "recognition API key"}"></div>
            </div>
            <div class="row" style="margin-top:8px">
                <button class="btn primary sm" id="fc-save">${icon("check")} Simpan layanan wajah</button>
            </div>
        </div>`;

}

function wirePeoplePanel(root) {

    const im = root.querySelector("#im-save");
    if (im) im.addEventListener("click", async () => {
        const body = { url: root.querySelector("#im-url").value.trim() };
        const k = root.querySelector("#im-key").value.trim();
        if (k) body.key = k;
        try {
            await api.request("/people/immich", { method: "POST", body });
            const st = await api.request("/people/status");
            toast(st.immich?.health?.online ? "Immich tersambung ✅" : (st.immich?.health?.error ?? "Tersimpan"),
                st.immich?.health?.online ? "ok" : "warn", 5000);
            await renderDaemonConfig(root);
        }
        catch (error) { toast(error.message, "danger", 6000); }
    });

    const fc = root.querySelector("#fc-save");
    if (fc) fc.addEventListener("click", async () => {
        const body = { url: root.querySelector("#fc-url").value.trim() };
        const k = root.querySelector("#fc-key").value.trim();
        if (k) body.key = k;
        try {
            await api.request("/people/face", { method: "POST", body });
            toast("Layanan wajah disimpan", "ok");
            await renderDaemonConfig(root);
        }
        catch (error) { toast(error.message, "danger", 6000); }
    });

}

function whatsappPanel(wa) {

    const statusPill = wa.connected
        ? pill(wa.number ? `tersambung · ${wa.number}` : "tersambung", "ok")
        : (wa.available ? pill("belum tertaut", "idle") : pill("paket belum diinstall", "warn"));

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("send")} WhatsApp</h2>
                <span class="push">${statusPill}</span>
            </div>

            <div class="stack">
                ${!wa.available ? `<div class="small warn-text">Jalankan di folder proyek:
                    <span class="mono">npm install @whiskeysockets/baileys</span> lalu mulai ulang daemon.</div>` : ""}

                <div class="field">
                    <label>Nomor WhatsApp (untuk pairing, format internasional)</label>
                    <input type="text" id="wa-number" value="${esc(wa.pairNumber ?? "")}"
                        placeholder="mis. 6281234567890 (tanpa + / spasi)">
                    <span class="help">Nomor perangkat yang menjalankan Aether. Setelah "Hubungkan", buka
                        WhatsApp di HP itu → <em>Perangkat Tertaut → Tautkan dengan nomor telepon</em>,
                        lalu masukkan kode di bawah.</span>
                </div>

                ${wa.pairingCode ? `<div class="panel" style="background:rgba(52,211,153,.08)">
                    <div class="small dim">Kode pairing (berlaku singkat):</div>
                    <div class="mono" style="font-size:26px;letter-spacing:4px">${esc(wa.pairingCode)}</div>
                </div>` : ""}

                <div class="field">
                    <label>Nomor pribadi yang diizinkan</label>
                    <input type="text" id="wa-allowed" value="${esc((wa.allowed ?? []).join(", "))}"
                        placeholder="mis. 6281111, 6282222">
                    <span class="help">Kirim <span class="mono">/id</span> ke Aether untuk tahu nomormu. Pisahkan koma. Tanpa ini chat pribadi ditolak.</span>
                </div>
                <div class="field">
                    <label>Id grup yang didaftarkan</label>
                    <input type="text" id="wa-groups" value="${esc((wa.groups ?? []).join(", "))}"
                        placeholder="mis. 120363012345678901@g.us">
                    <span class="help">Kirim <span class="mono">/id</span> di grup untuk tahu id-nya. Di grup, Aether menjawab saat di-mention (sebut <em>Aether</em>) atau di-reply.</span>
                </div>
                ${wa.lastError ? `<div class="small danger-text">${esc(wa.lastError)}</div>` : ""}
                <div class="row">
                    <button class="btn primary" id="wa-save">${icon("check")} Simpan</button>
                    <button class="btn" id="wa-connect">${icon("plug")} Hubungkan / minta kode</button>
                    <button class="btn ghost" id="wa-test" ${wa.connected ? "" : "disabled"}>${icon("send")} Kirim uji</button>
                    <button class="btn ghost danger" id="wa-logout" ${wa.connected ? "" : "disabled"}>${icon("x")} Putuskan</button>
                </div>
            </div>
        </div>`;

}

function providerFields(cfg, mode, platformId) {

    if (mode === "ollama") {
        const o = cfg.ollama;
        return `
            <div class="field">
                <label>Base URL Ollama</label>
                <input type="url" id="ai-baseurl" value="${esc(o.baseUrl)}" placeholder="http://localhost:11434">
            </div>
            ${modelField(o.model)}`;
    }

    const p = cfg.providers[platformId];

    return `
        <div class="field">
            <label>Platform</label>
            <select id="ai-platform">
                ${Object.keys(cfg.providers).map(pid =>
                    `<option value="${esc(pid)}" ${pid === platformId ? "selected" : ""}>${esc(cfg.providers[pid].label)}</option>`
                ).join("")}
            </select>
        </div>
        <div class="field">
            <label>API key ${p.hasKey ? `<span class="dim">(tersimpan: ${esc(p.keyHint)})</span>` : ""}</label>
            <input type="password" id="ai-key" placeholder="${p.hasKey ? "isi untuk mengganti, kosongkan untuk pakai AI Lokal" : "tempel API key di sini"}">
            <span class="help">Kosongkan &amp; simpan untuk menghapus key (Aether balik ke AI Lokal).</span>
        </div>
        <div class="field">
            <label>Base URL</label>
            <input type="url" id="ai-baseurl" value="${esc(p.baseUrl)}" placeholder="${esc(p.defaultBaseUrl)}">
        </div>
        ${modelField(p.model)}`;

}

function wireAiPanel(root, cfg) {

    const modeSeg = root.querySelector("#ai-mode");
    const fields = root.querySelector("#ai-provider-fields");

    const providerIds = Object.keys(cfg.providers);

    let mode = cfg.active === "ollama" ? "ollama" : "provider";
    let platform = cfg.active !== "ollama"
        ? cfg.active
        : (providerIds.find(id => cfg.providers[id].hasKey) ?? providerIds[0]);

    const draw = () => {
        fields.innerHTML = providerFields(cfg, mode, platform);
        wireFields();
    };

    function wireFields() {

        const plat = fields.querySelector("#ai-platform");
        if (plat) {
            plat.addEventListener("change", () => { platform = plat.value; draw(); });
        }

        const modelSel = fields.querySelector("#ai-model");
        const manual = fields.querySelector("#ai-model-manual");
        if (modelSel && manual) {
            modelSel.addEventListener("change", () => {
                const isManual = modelSel.value === "__manual__";
                manual.style.display = isManual ? "" : "none";
                if (isManual) manual.focus();
            });
        }

        const loadBtn = fields.querySelector("#ai-load-models");
        if (loadBtn) {
            loadBtn.addEventListener("click", loadModels);
        }

    }

    /** Simpan kredensial lalu ambil daftar model yang benar-benar tersedia. */
    async function loadModels() {

        const help = fields.querySelector("#ai-model-help");
        const modelSel = fields.querySelector("#ai-model");
        const loadBtn = fields.querySelector("#ai-load-models");

        help.textContent = "Menyimpan kredensial & memuat model…";
        loadBtn.disabled = true;

        try {

            // Model hanya bisa didaftar dengan provider yang aktif,
            // jadi simpan dulu (tanpa toast) agar daemon memakai key ini.
            await persist(false);

            const data = await api.models();
            const list = data.models ?? [];

            const current = data.defaultModel ?? "";

            modelSel.innerHTML =
                `<option value="">— pilih model —</option>` +
                list.map(m =>
                    `<option value="${esc(m.id)}" ${m.id === current ? "selected" : ""}>${esc(m.name ?? m.id)}</option>`
                ).join("") +
                `<option value="__manual__">✎ ketik manual…</option>`;

            help.textContent = list.length
                ? `${list.length} model tersedia — pilih lalu tekan Simpan.`
                : "Tidak ada model terbaca. Coba ketik manual atau periksa key/URL.";

        }
        catch (error) {
            help.textContent = `Gagal memuat: ${error.message}`;
        }
        finally {
            loadBtn.disabled = false;
        }

    }

    /** Baca model terpilih (dropdown atau input manual). */
    function readModel() {
        const modelSel = fields.querySelector("#ai-model");
        const manual = fields.querySelector("#ai-model-manual");
        if (modelSel?.value === "__manual__") {
            return manual.value.trim();
        }
        return modelSel?.value.trim() ?? "";
    }

    /** Kirim konfigurasi ke daemon. showToast=false dipakai saat memuat model. */
    async function persist(showToast) {

        const baseUrl = fields.querySelector("#ai-baseurl")?.value.trim();
        const model = readModel();

        const body = { active: mode === "ollama" ? "ollama" : platform };

        if (mode === "ollama") {
            body.ollama = { baseUrl, model };
        }
        else {
            const key = fields.querySelector("#ai-key")?.value ?? "";
            body.provider = {
                id: platform,
                ...(key !== "" ? { apiKey: key } : {}),
                baseUrl,
                model
            };
        }

        const result = await api.request("/ai/config", { method: "POST", body });

        if (showToast) {
            const v = result.verify;
            toast(
                v?.note ? `${result.reconfigured.platform}: ${v.note}` : `AI aktif: ${result.reconfigured.platform}`,
                v && v.ok === false ? "warn" : "ok",
                6000
            );
            await renderDaemonConfig(root);
            document.dispatchEvent(new CustomEvent("aether:reconnect"));
        }

        return result;

    }

    modeSeg.querySelectorAll("[data-mode]").forEach(button => {
        button.addEventListener("click", () => {
            mode = button.dataset.mode;
            modeSeg.querySelectorAll("[data-mode]").forEach(b =>
                b.classList.toggle("active", b === button));
            draw();
        });
    });

    root.querySelector("#ai-save").addEventListener("click", async () => {
        try {
            await persist(true);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }
    });

    draw();

}

function wireWhatsappPanel(root) {

    const body = () => ({
        number: root.querySelector("#wa-number").value.trim(),
        allowed: root.querySelector("#wa-allowed").value.trim(),
        groups: root.querySelector("#wa-groups").value.trim()
    });

    root.querySelector("#wa-save").addEventListener("click", async () => {
        try {
            await api.request("/whatsapp/config", { method: "POST", body: body() });
            toast("Setelan WhatsApp disimpan", "ok");
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }
    });

    root.querySelector("#wa-connect").addEventListener("click", async () => {
        try {
            // Simpan dulu (nomor & izin) baru minta kode pairing.
            await api.request("/whatsapp/config", { method: "POST", body: body() });
            const status = await api.request("/whatsapp/connect", { method: "POST", body: {} });
            toast(
                status.pairingCode
                    ? `Kode pairing: ${status.pairingCode}`
                    : (status.connected ? "Sudah tersambung" : (status.lastError ?? "Menyambungkan…")),
                status.lastError ? "warn" : "ok",
                8000
            );
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }
    });

    const testBtn = root.querySelector("#wa-test");
    if (testBtn) testBtn.addEventListener("click", async () => {
        try {
            const r = await api.request("/whatsapp/test", { method: "POST", body: {} });
            toast(`Terkirim ke ${r.recipients} chat`, "ok");
        }
        catch (error) {
            toast(error.message, "danger");
        }
    });

    const logoutBtn = root.querySelector("#wa-logout");
    if (logoutBtn) logoutBtn.addEventListener("click", async () => {
        try {
            await api.request("/whatsapp/logout", { method: "POST", body: {} });
            toast("WhatsApp diputuskan", "ok");
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger");
        }
    });

}

function automationPanel(a) {

    a = a ?? { enabled: false, time: "07:00", lastSent: null };

    return `
        <div class="panel">
            <div class="panel-head">
                <h2>${icon("activity")} Proaktif — brief harian</h2>
                <span class="push">${pill(a.enabled ? "aktif" : "mati", a.enabled ? "ok" : "idle")}</span>
            </div>
            <div class="small muted" style="margin-bottom:10px">
                Aether menyapa lebih dulu: ringkasan keadaan rumah dikirim otomatis
                ke WhatsApp yang diizinkan pada jam yang kamu tentukan.
            </div>
            <div class="row wrap" style="gap:14px">
                <label class="switch">
                    <input type="checkbox" id="auto-enabled" ${a.enabled ? "checked" : ""}>
                    <span class="track"></span><span>Aktifkan brief harian</span>
                </label>
                <div class="field" style="max-width:140px">
                    <label>Jam kirim</label>
                    <input type="time" id="auto-time" value="${esc(a.time ?? "07:00")}">
                </div>
            </div>
            <div class="row" style="margin-top:10px">
                <button class="btn primary" id="auto-save">${icon("check")} Simpan</button>
                <button class="btn ghost" id="auto-run">${icon("send")} Kirim brief sekarang</button>
                ${a.lastSent ? `<span class="small dim">terakhir: ${esc(a.lastSent)}</span>` : ""}
            </div>
        </div>`;

}

function wireAutomationPanel(root) {

    root.querySelector("#auto-save").addEventListener("click", async () => {
        try {
            await api.request("/automation/config", { method: "POST", body: {
                enabled: root.querySelector("#auto-enabled").checked,
                time: root.querySelector("#auto-time").value
            }});
            toast("Setelan brief disimpan", "ok");
            await renderDaemonConfig(root);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }
    });

    root.querySelector("#auto-run").addEventListener("click", async () => {
        try {
            const r = await api.request("/automation/run", { method: "POST", body: {} });
            toast(`Brief terkirim ke ${r.recipients} chat`, r.recipients ? "ok" : "warn", 5000);
        }
        catch (error) {
            toast(error.message, "danger", 6000);
        }
    });

}
