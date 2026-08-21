const test = require("node:test");
const assert = require("node:assert");

const { StateMachine, STATES } = require("../../src/voice/stateMachine");
const { WakeWordProvider } = require("../../src/voice/providers/wakeWord");
const { VadDetector } = require("../../src/voice/providers/vad");
const { AudioInput } = require("../../src/voice/providers/audioInput");
const { AudioOutput } = require("../../src/voice/providers/audioOutput");
const { VoiceRuntime } = require("../../src/voice/voiceRuntime");
const { VoiceSession } = require("../../src/voice/voiceSession");

/**
 * Voice Runtime — always-on assistant. Semua test menguji PERILAKU
 * fungsional: state machine, wake word, VAD, graceful degradation.
 * Tidak ada yang menguji hardware audio sungguhan (backend default none).
 */

// ---- StateMachine ----

test("state machine: transisi sah mengikuti lifecycle", () => {
    const sm = new StateMachine();
    assert.equal(sm.current, STATES.IDLE);

    assert.equal(sm.transit(STATES.WAKE_DETECTED), true);
    assert.equal(sm.transit(STATES.LISTENING), true);
    assert.equal(sm.transit(STATES.TRANSCRIBING), true);
    assert.equal(sm.transit(STATES.THINKING), true);
    assert.equal(sm.transit(STATES.SPEAKING), true);
    assert.equal(sm.transit(STATES.IDLE), true);
});

test("state machine: lompatan ilegal ditolak (IDLE → SPEAKING)", () => {
    const sm = new StateMachine();
    assert.equal(sm.transit(STATES.SPEAKING), false, "IDLE tidak boleh langsung SPEAKING");
    assert.equal(sm.current, STATES.IDLE);
});

test("state machine: barge-in SPEAKING → LISTENING sah", () => {
    const sm = new StateMachine();
    sm.transit(STATES.WAKE_DETECTED);
    sm.transit(STATES.LISTENING);
    sm.transit(STATES.TRANSCRIBING);
    sm.transit(STATES.THINKING);
    sm.transit(STATES.SPEAKING);
    assert.equal(sm.transit(STATES.LISTENING), true, "barge-in harus sah");
});

test("state machine: reset paksa kembali ke IDLE", () => {
    const sm = new StateMachine();
    sm.transit(STATES.WAKE_DETECTED);
    sm.transit(STATES.LISTENING);
    sm.reset();
    assert.equal(sm.current, STATES.IDLE);
});

test("state machine: elapsed melacak waktu masuk state", async () => {
    const sm = new StateMachine();
    sm.transit(STATES.WAKE_DETECTED);
    await new Promise(r => setTimeout(r, 20));
    assert.ok(sm.elapsed() >= 20);
});

// ---- WakeWordProvider ----

test("wake word: mendeteksi kata panggil utuh", () => {
    const w = new WakeWordProvider({ wakeWord: "aether" });
    assert.equal(w.detect("Aether").detected, true);
    assert.equal(w.detect("hej aether buka cctv").detected, true);
});

test("wake word: TIDAK mendeteksi substring (ethereum)", () => {
    const w = new WakeWordProvider({ wakeWord: "aether" });
    assert.equal(w.detect("ethereum").detected, false, "jangan salah deteksi substring");
});

test("wake word: kosong → tidak terdeteksi", () => {
    const w = new WakeWordProvider({ wakeWord: "aether" });
    assert.equal(w.detect("").detected, false);
});

// ---- VadDetector ----

test("VAD: selesai setelah diam melewati timeout", () => {
    const v = new VadDetector({ vadTimeoutMs: 50 });
    const now = Date.now();
    v.start(now);
    assert.equal(v.selesai(now), false);
    assert.equal(v.selesai(now + 60), true, "diam 60ms > timeout 50ms harus selesai");
});

test("VAD: touch memperpanjang (masih bicara)", () => {
    const v = new VadDetector({ vadTimeoutMs: 50 });
    const now = Date.now();
    v.start(now);
    v.touch(now + 40);
    assert.equal(v.selesai(now + 80), false, "baru 40ms sejak touch");
    assert.equal(v.selesai(now + 100), true);
});

// ---- AudioInput / AudioOutput (graceful default none) ----

test("AudioInput backend none: probe false, startCapture null (tanpa error)", async () => {
    const a = new AudioInput({ backend: "none" });
    assert.equal(await a.probe(), false);
    assert.equal(await a.startCapture({ durationMs: 100 }), null);
});

test("AudioOutput backend none: play no-op (tanpa error), status false", async () => {
    const o = new AudioOutput({ backend: "none" });
    assert.equal(await o.probe(), false);
    await o.play(Buffer.from([1, 2, 3])); // harus no-op tanpa throw
    assert.equal(o.status().available, false);
});

test("AudioOutput CLI: probe + play tidak melempar (graceful)", async () => {
    const o = new AudioOutput({ backend: "cli" });
    const ok = await o.probe(); // true bila ffplay/aplay/powershell ada

    // play() dengan buffer kecil: bila player ada, ia memutar (dan bisa
    // di-interrupt); bila tidak, no-op. Keduanya tak boleh melempar.
    await o.play(Buffer.from([1, 2, 3, 4]));

    assert.ok(ok === true || ok === false);
});

test("AudioOutput.stop: membunuh _child dan mengosongkannya (barge-in)", async () => {
    const o = new AudioOutput({ backend: "cli" });

    // Simulasikan proses pemutar aktif.
    const fake = {
        killed: false,
        kill(sig) { this.killed = true; }
    };
    o._child = fake;

    await o.stop();

    assert.equal(fake.killed, true);
    assert.equal(o._child, null);
    assert.equal(o.status().playing, false);
});

test("AudioInput CLI: probe + startCapture tidak melempar (graceful)", async () => {
    const a = new AudioInput({ backend: "cli" });
    const ok = await a.probe(); // true bila ffmpeg/arecord ada, false bila tidak

    const cap = await a.startCapture({ durationMs: 100 });

    if (ok) {
        // Recorder tersedia → harus mengembalikan objek capture valid.
        assert.ok(cap, "bila recorder ada, startCapture harus mengembalikan objek");
        assert.equal(typeof cap.stop, "function");
        const buf = await cap.stop();
        assert.ok(Buffer.isBuffer(buf), "stop harus mengembalikan Buffer");
    }
    else {
        // Tanpa recorder → null, tidak melempar.
        assert.equal(cap, null);
    }
});

test("AudioInput: argumen ffmpeg/arecord benar (16kHz mono WAV)", () => {
    const a = new AudioInput({ backend: "cli" });

    const ff = a._ffmpegArgs("/tmp/x.wav", 3);
    assert.equal(ff.cmd, "ffmpeg");
    assert.ok(ff.args.includes("-ar"));
    assert.ok(ff.args.includes("16000"));
    assert.ok(ff.args.includes("-ac"));
    assert.ok(ff.args.includes("1"));

    const ar = a._arecordArgs("/tmp/x.wav", 3);
    assert.equal(ar.cmd, "arecord");
    assert.ok(ar.args.includes("16000"));
});

// ---- VoiceRuntime (graceful degradation + wake + ack) ----

function makeRuntime(overrides = {}) {
    return new VoiceRuntime({
        config: () => ({
            enabled: true,
            wakeWord: "aether",
            wakeProvider: "local",
            sttProvider: "local",
            ttsProvider: "local",
            maxSessionMs: 60000,
            vadTimeoutMs: 100,
            maxListenMs: 1000,
            acknowledgement: "Ya?",
            language: "id",
            ...overrides
        })
    });
}

test("VoiceRuntime: wakeDetect memicu WAKE_DETECTED + ack (tanpa LLM)", async () => {
    const rt = makeRuntime();
    let acked = null;
    rt.on("ack", a => { acked = a; });

    const r = rt.wakeDetect("Aether");
    assert.equal(r.detected, true);
    assert.equal(rt.machine.current, STATES.WAKE_DETECTED);
    assert.equal(acked, "Ya?");

    await rt.stop();
});

test("VoiceRuntime: nonaktif default — start tidak mengaktifkan loop", async () => {
    const rt = new VoiceRuntime({
        config: () => ({ enabled: false, wakeWord: "aether", acknowledgement: "Ya?" })
    });
    await rt.start();
    assert.equal(rt.enabled, false);
    assert.equal(rt.running, false);
    await rt.stop();
});

test("VoiceRuntime: interrupt (barge-in) menghentikan TTS dan kembali", async () => {
    const rt = makeRuntime();
    let interrupted = false;
    rt.on("interrupt", () => { interrupted = true; });

    // Simulasikan sedang SPEAKING lalu interupsi.
    rt.machine.transit(STATES.WAKE_DETECTED);
    rt.machine.transit(STATES.LISTENING);
    rt.machine.transit(STATES.TRANSCRIBING);
    rt.machine.transit(STATES.THINKING);
    rt.machine.transit(STATES.SPEAKING);

    await rt.interrupt();

    assert.equal(interrupted, true);
    assert.equal(rt.machine.current, STATES.LISTENING);

    await rt.stop();
});

test("VoiceRuntime: TTS/speaker gagal TIDAK melempar (daemon tetap hidup)", async () => {
    const rt = makeRuntime();
    // speak() harus menelan kegagalan, tidak re-throw.
    await rt.speak("tes"); // backend none → output.play no-op; voiceService.speak mungkin throw (TTS tak ada)
    // Yang penting: tidak ada exception keluar.
    assert.ok(true);
    await rt.stop();
});

// ---- VoiceSession (jalur AI yang sama) ----

test("VoiceSession.think memakai aiRuntime yang di-inject (bukan loop kedua)", async () => {
    // Mock aiRuntime: pastikan dipanggil dengan channel "voice" + tools undefined.
    let captured = null;
    const fakeRuntime = {
        chat: async (req) => {
            captured = req;
            return { content: "Suhu 27 derajat." };
        }
    };

    const session = new VoiceSession({ aiRuntime: fakeRuntime });
    const { answer } = await session.think("Berapa suhu kamar?");

    assert.equal(answer, "Suhu 27 derajat.");
    assert.equal(captured.channel, "voice");
    assert.equal(captured.tools, undefined, "tools undefined → ToolSelector otomatis");

    // Riwayat persisten tercatat.
    const history = await session.history();
    assert.equal(history.length, 2);
    assert.equal(history[0].role, "user");
    assert.equal(history[1].role, "assistant");
});

// ---- Graceful degradation lanjutan ----

test("VoiceRuntime.handleTranscript: model gagal → reset, tidak throw", async () => {
    const failingRuntime = {
        chat: async () => { throw new Error("model offline"); }
    };

    const rt = makeRuntime();
    rt.session = new VoiceSession({ aiRuntime: failingRuntime });

    const res = await rt.handleTranscript("halo");

    assert.equal(res.error, "model offline");
    assert.equal(rt.machine.current, STATES.IDLE, "harus reset ke IDLE setelah gagal");
    assert.equal(rt.lastError, "model offline");

    await rt.stop();
});

test("VoiceRuntime: input/mic unavailable tidak memblokir status", async () => {
    const rt = makeRuntime();
    await rt.start(); // backend none → probe false, tapi start tetap sukses
    const s = rt.status();
    assert.equal(s.microphone.available, false);
    assert.equal(s.speaker.available, false);
    assert.equal(s.enabled, true);
    await rt.stop();
});

test("VoiceRuntime.stop: bersih tanpa error (daemon shutdown aman)", async () => {
    const rt = makeRuntime();
    await rt.start();
    await rt.stop();
    assert.equal(rt.running, false);
    assert.equal(rt.machine.current, STATES.IDLE);
});
