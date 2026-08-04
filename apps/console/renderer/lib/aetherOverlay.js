import { store } from "./store.js";
import { api } from "./api.js";
import { icon } from "./icons.js";
import { esc, toast } from "./ui.js";
import { createHologram } from "./hologram.js";
import { tts, MicRecorder } from "./voice.js";

/**
 * Aether Overlay — percakapan hologram FULLSCREEN.
 *
 * Saat orb diklik / user mulai bicara di Beranda / wake word "aether":
 * hologram JARVIS menutupi seluruh layar dan live-chat muncul DI ATASNYA
 * (bukan pindah ke jendela app). Bicara langsung: mode suara mulai
 * mendengar, VAD sederhana meng-auto-stop saat hening, jawaban dibacakan
 * (TTS) sambil hologram berdenyut, lalu mendengar lagi (hands-free).
 *
 * Memakai ulang pipeline yang sama dengan view Aether: api.streamChat,
 * tts.say, MicRecorder. Degradasi anggun bila STT daemon belum diset.
 */

const conversation = [];
let holo = null;
let recorder = null;
let recording = false;
let busy = false;
let voiceMode = false;
let sttConfigured = false;
let vad = null;
let els = null;

const prefs = { autoSpeak: true, voiceName: null, rate: 1, robot: false };

const STATUS = {
    idle:      { t: "Siap", d: "var(--neon-cyan)" },
    listening: { t: "Mendengar…", d: "var(--ok)" },
    thinking:  { t: "Berpikir…", d: "var(--accent-3)" },
    speaking:  { t: "Berbicara…", d: "var(--neon-cyan)" },
    error:     { t: "Ada kendala", d: "var(--danger)" },
    offline:   { t: "Tak terhubung", d: "var(--danger)" }
};

// ---- DOM (dibangun sekali) ----------------------------------------

function build() {
    if (els) return els;

    const el = document.createElement("div");
    el.className = "ae-overlay";
    el.id = "ae-overlay";
    el.innerHTML = `
        <div class="ae-holo-bg" id="ae-ov-holo"></div>
        <div class="ae-scan"></div>
        <div class="ae-arcs"><span></span><span></span><span></span></div>
        <button class="ae-close" id="ae-ov-close" title="Tutup (Esc)">${icon("close") || "✕"}</button>
        <div class="ae-status" id="ae-ov-status"><span class="dot"></span><span class="t">Siap</span></div>
        <div class="ae-convo" id="ae-ov-convo"></div>
        <form class="ae-inputbar" id="ae-ov-form">
            <button type="button" class="ae-mic" id="ae-ov-mic" title="Bicara">${icon("mic")}</button>
            <input id="ae-ov-input" autocomplete="off" placeholder="Bicara atau ketik pada Aether…" />
            <button type="submit" class="ae-send" title="Kirim">${icon("send")}</button>
        </form>`;
    document.body.appendChild(el);

    els = {
        root: el,
        holo: el.querySelector("#ae-ov-holo"),
        convo: el.querySelector("#ae-ov-convo"),
        form: el.querySelector("#ae-ov-form"),
        input: el.querySelector("#ae-ov-input"),
        mic: el.querySelector("#ae-ov-mic"),
        status: el.querySelector("#ae-ov-status")
    };

    els.form.addEventListener("submit", e => { e.preventDefault(); submitText(); });
    els.mic.addEventListener("click", () => toggleMic());
    el.querySelector("#ae-ov-close").addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && el.classList.contains("open")) close(); });

    return els;
}

// ---- Buka / tutup --------------------------------------------------

export async function openOverlay({ text = null, voice = false } = {}) {

    build();
    els.root.classList.add("open");
    document.body.classList.add("ae-immersed");

    if (!holo) {
        try {
            holo = createHologram();
            els.holo.appendChild(holo.el);
        }
        catch { holo = null; }
    }

    setState(store.get().connected ? "idle" : "offline");
    render();

    // Preferensi suara + kesiapan STT.
    try {
        const saved = await window.aether.settings.get();
        if (saved.tts) Object.assign(prefs, saved.tts);
    } catch { /* default */ }
    await tts.load();
    await tts.refreshStatus();
    try { sttConfigured = (await api.voiceStatus()).stt.configured; } catch { sttConfigured = false; }

    voiceMode = voice;

    if (text) { await ask(text); }
    else if (voice) { setTimeout(() => startListening(), 250); }
    else { els.input.focus(); }
}

export function close() {
    if (!els) return;
    voiceMode = false;
    tts.cancel();
    stopVad();
    recorder?.abort(); recorder = null; recording = false;
    els.root.classList.remove("open");
    document.body.classList.remove("ae-immersed");
    els.mic.classList.remove("recording");
    if (holo) { holo.destroy(); holo = null; els.holo.innerHTML = ""; }
}

export function isOpen() { return !!els && els.root.classList.contains("open"); }

// ---- Percakapan ----------------------------------------------------

function submitText() {
    const v = els.input.value.trim();
    if (!v || busy) return;
    els.input.value = "";
    voiceMode = false;                    // ketik = mode teks
    ask(v);
}

async function ask(text) {

    if (!store.get().connected) { toast("Belum terhubung ke daemon.", "warn"); setState("offline"); return; }

    busy = true;
    conversation.push({ role: "user", content: text });
    const assistant = { role: "assistant", content: "" };
    conversation.push(assistant);
    render();
    setState("thinking");

    try {
        await api.streamChat(
            {
                messages: conversation.filter(m => m.content && !m.error).map(({ role, content }) => ({ role, content })),
                model: undefined
            },
            ({ event, data }) => {
                if (event === "chunk" && data.delta) { assistant.content += data.delta; render(); }
                else if (event === "error") { assistant.error = data.message; }
            }
        );

        if (assistant.error) { setState("error"); toast(assistant.error, "danger"); }
        else if (assistant.content.trim()) { await speak(assistant.content); }
        else { setState("idle"); }
    }
    catch (error) {
        assistant.error = error.message; render(); setState("error"); toast(error.message, "danger");
    }
    finally {
        busy = false;
        if (holo && holo.state !== "error" && !recording) setState("idle");
    }
}

async function speak(text) {
    if (!prefs.autoSpeak || !tts.available()) {
        setState("idle");
        if (voiceMode && sttConfigured) startListening();
        return;
    }
    setState("speaking");
    await tts.say(text, {
        voice: prefs.voiceName, rate: prefs.rate ?? 1, pitch: 1, robot: prefs.robot,
        onLevel: (v) => holo?.setLevel(v),
        onEnd: () => {
            holo?.setLevel(0);
            setState("idle");
            if (voiceMode && sttConfigured) startListening();   // lanjut dengar (hands-free)
        }
    });
}

// ---- Suara masuk (STT daemon) + VAD auto-stop ----------------------

async function startListening() {
    if (recording || busy) return;
    if (!sttConfigured) {
        // Mode suara tanpa STT daemon: jatuh ke teks.
        voiceMode = false;
        els.input.focus();
        toast("Suara-masuk belum diset (AETHER_STT_URL). Ketik saja — Aether tetap menjawab bersuara.", "warn", 5000);
        return;
    }
    try {
        tts.cancel();
        recorder = new MicRecorder({ language: "id" });
        let loudAt = 0, heard = false;
        recorder.onLevel = (v) => {
            holo?.setLevel(v);
            const now = Date.now();
            if (v > 0.14) { loudAt = now; heard = true; }
            // VAD: setelah mendengar suara lalu hening ~1.4s → stop otomatis.
            if (heard && now - loudAt > 1400) finishListening();
        };
        await recorder.start();
        recording = true;
        els.mic.classList.add("recording");
        setState("listening");
        // Batas aman: bila tak ada suara sama sekali 8s, hentikan.
        vad = setTimeout(() => { if (!heard) finishListening(); }, 8000);
    }
    catch (error) { toast(`Mikrofon: ${error.message}`, "danger"); setState("idle"); }
}

async function finishListening() {
    if (!recording) return;
    recording = false;
    stopVad();
    els.mic.classList.remove("recording");
    holo?.setLevel(0);
    setState("thinking");
    try {
        const { text } = await recorder.stopAndTranscribe();
        recorder = null;
        if (text?.trim()) await ask(text.trim());
        else { setState("idle"); if (voiceMode && sttConfigured) startListening(); }
    }
    catch (error) { toast(error.message, "danger"); setState("idle"); }
}

function toggleMic() {
    if (recording) { voiceMode = true; finishListening(); }
    else { voiceMode = true; startListening(); }
}

function stopVad() { if (vad) { clearTimeout(vad); vad = null; } }

// ---- Tampilan ------------------------------------------------------

function setState(state) {
    holo?.setState(state);
    if (!els) return;
    const info = STATUS[state] ?? STATUS.idle;
    els.status.querySelector(".t").textContent = info.t;
    els.status.querySelector(".dot").style.background = info.d;
    els.status.querySelector(".dot").style.boxShadow = `0 0 10px ${info.d}`;
}

function render() {
    if (!els) return;
    const host = els.convo;
    if (conversation.length === 0) {
        host.innerHTML = `<div class="ae-hint">Ucapkan “Aether”, atau tanyakan apa saja…</div>`;
        return;
    }
    host.innerHTML = conversation.slice(-8).map(m => {
        const cls = m.role === "user" ? "u" : "a";
        const body = m.error ? `<span class="danger-text">${esc(m.error)}</span>` : esc(m.content || "…");
        return `<div class="ae-msg ${cls}"><span class="who">${m.role === "user" ? "Kamu" : "Aether"}</span><div class="bub">${body}</div></div>`;
    }).join("");
    host.scrollTop = host.scrollHeight;
}
