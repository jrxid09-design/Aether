import { api } from "./api.js";

/**
 * Suara untuk Aether.
 *
 * Keluar (TTS): speechSynthesis milik OS — offline, tanpa server.
 * Masuk (STT): rekam mic → kirim ke daemon → teks.
 *
 * Keduanya dibuat "gagal dengan anggun": kalau tidak ada voice
 * atau STT belum dikonfigurasi, fungsinya menolak dengan pesan
 * jelas, bukan diam-diam rusak.
 */

// =====================================================================
// TTS
// =====================================================================

export const tts = {

    voices: [],

    ready: false,

    /** Voice memuat asinkron di Chromium; tunggu sampai ada. */
    load() {

        return new Promise(resolve => {

            const grab = () => {
                this.voices = window.speechSynthesis?.getVoices() ?? [];
                if (this.voices.length) {
                    this.ready = true;
                    resolve(this.voices);
                    return true;
                }
                return false;
            };

            if (grab()) {
                return;
            }

            if (!window.speechSynthesis) {
                resolve([]);
                return;
            }

            window.speechSynthesis.onvoiceschanged = () => grab();

            // Fallback bila event tidak pernah menyala.
            setTimeout(() => { grab(); resolve(this.voices); }, 1200);

        });

    },

    available() {
        return typeof window.speechSynthesis !== "undefined";
    },

    /** Voice Indonesia bila ada, kalau tidak voice default sistem. */
    pickDefault() {

        return (
            this.voices.find(v => /^id/i.test(v.lang)) ??
            this.voices.find(v => v.default) ??
            this.voices[0] ??
            null
        );

    },

    findByName(name) {
        return this.voices.find(v => v.name === name) ?? null;
    },

    /**
     * Ucapkan teks. onBoundary dipanggil tiap batas kata — dipakai
     * untuk menggerakkan mulut avatar; onEnd saat selesai.
     */
    speak(text, { voice = null, rate = 1, pitch = 1, onBoundary, onStart, onEnd } = {}) {

        return new Promise((resolve) => {

            if (!this.available() || !text?.trim()) {
                onEnd?.();
                resolve();
                return;
            }

            // Batalkan ucapan sebelumnya agar tidak menumpuk.
            window.speechSynthesis.cancel();

            const utter = new SpeechSynthesisUtterance(text);

            const chosen = voice
                ? (this.findByName(voice) ?? this.pickDefault())
                : this.pickDefault();

            if (chosen) {
                utter.voice = chosen;
                utter.lang = chosen.lang;
            }

            utter.rate = rate;
            utter.pitch = pitch;

            utter.onstart = () => onStart?.();
            utter.onboundary = (e) => onBoundary?.(e);
            utter.onend = () => { onEnd?.(); resolve(); };
            utter.onerror = () => { onEnd?.(); resolve(); };

            window.speechSynthesis.speak(utter);

        });

    },

    cancel() {
        window.speechSynthesis?.cancel();
    },

    get speaking() {
        return window.speechSynthesis?.speaking ?? false;
    }

};

// =====================================================================
// STT — rekam mikrofon lalu kirim ke daemon
// =====================================================================

export class MicRecorder {

    constructor({ deviceId = null, language = "id" } = {}) {
        this.deviceId = deviceId;
        this.language = language;
        this.stream = null;
        this.recorder = null;
        this.chunks = [];
        this.recording = false;
        this.onLevel = null;
        this.audioContext = null;
        this.raf = null;
    }

    async start() {

        if (this.recording) {
            return;
        }

        this.stream = await navigator.mediaDevices.getUserMedia({
            audio: this.deviceId ? { deviceId: { exact: this.deviceId } } : true
        });

        this.chunks = [];

        // Pilih tipe yang didukung; webm/opus paling umum di Chromium.
        const mimeType = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus"
        ].find(t => MediaRecorder.isTypeSupported(t)) ?? "";

        this.recorder = new MediaRecorder(
            this.stream,
            mimeType ? { mimeType } : undefined
        );

        this.mimeType = this.recorder.mimeType || mimeType || "audio/webm";

        this.recorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        this.recorder.start();
        this.recording = true;

        this.startLevelMeter();

    }

    /** Hentikan rekaman, kembalikan Blob audio. */
    stop() {

        return new Promise((resolve) => {

            if (!this.recorder || !this.recording) {
                resolve(null);
                return;
            }

            this.recorder.onstop = () => {
                const blob = new Blob(this.chunks, { type: this.mimeType });
                this.cleanup();
                resolve(blob);
            };

            this.recorder.stop();
            this.recording = false;

        });

    }

    /** Rekam sampai stop() lalu transkripsi lewat daemon. */
    async stopAndTranscribe() {

        const blob = await this.stop();

        if (!blob || blob.size === 0) {
            return { text: "" };
        }

        const base64 = await blobToBase64(blob);

        return api.transcribe({
            audio: base64,
            mimeType: this.mimeType,
            language: this.language
        });

    }

    /** Meter level untuk umpan balik visual saat mendengarkan. */
    startLevelMeter() {

        if (!this.onLevel) {
            return;
        }

        this.audioContext = new AudioContext();
        const source = this.audioContext.createMediaStreamSource(this.stream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const buf = new Float32Array(analyser.fftSize);

        const tick = () => {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += v * v;
            const rms = Math.sqrt(sum / buf.length);
            this.onLevel(Math.min(1, Math.sqrt(rms) * 2.2));
            this.raf = requestAnimationFrame(tick);
        };

        this.raf = requestAnimationFrame(tick);

    }

    cleanup() {

        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }

        this.audioContext?.close().catch(() => {});
        this.audioContext = null;

        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;

    }

    abort() {
        this.recording = false;
        try { this.recorder?.stop(); } catch { /* sudah berhenti */ }
        this.cleanup();
    }

}

function blobToBase64(blob) {

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // dataURL: "data:audio/webm;base64,XXXX" → ambil bagian base64.
            const result = String(reader.result);
            resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });

}
