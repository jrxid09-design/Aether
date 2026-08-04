/**
 * Wake word "aether" — Aether selalu standby.
 *
 * Memakai Web Speech API (SpeechRecognition) Chromium: mendengarkan
 * terus-menerus, mencocokkan pemicu "aether" (plus varian salah-dengar
 * yang umum), lalu memanggil onWake. Auto-restart karena recognition
 * kontinu kadang berhenti sendiri. Degradasi anggun: bila API tak ada,
 * available()=false dan pemanggil mengandalkan tombol mic manual.
 *
 * ponytail: mengandalkan STT bawaan browser (butuh dukungan speech engine
 * OS/daring); untuk wake-word 100% offline perlu model lokal (mis. Porcupine)
 * — upgrade bila dibutuhkan.
 */

const VARIANTS = ["aether", "either", "ether", "aither", "ather", "aetha", "aitha", "hey aether", "ok aether"];

export function createWakeWord({ onWake, onListenStart, onError, cooldownMs = 2500 } = {}) {

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    let active = false;
    let lastHit = 0;

    function available() { return !!SR; }

    function matches(text) {
        const t = text.toLowerCase();
        return VARIANTS.some(v => t.includes(v));
    }

    function start() {
        if (!SR || active) return false;

        rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";                 // pengucapan "aether" ala Inggris

        rec.onresult = (e) => {
            const now = Date.now();
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const txt = e.results[i][0].transcript;
                if (matches(txt) && now - lastHit > cooldownMs) {
                    lastHit = now;
                    onWake?.(txt.trim());
                }
            }
        };

        rec.onerror = (ev) => {
            // 'no-speech'/'aborted' normal saat kontinu — jangan berisik.
            if (!["no-speech", "aborted"].includes(ev.error)) onError?.(ev.error);
        };

        rec.onend = () => { if (active) { try { rec.start(); } catch { /* akan dicoba lagi */ } } };

        active = true;
        try { rec.start(); onListenStart?.(); } catch { /* butuh izin mic */ }
        return true;
    }

    function stop() {
        active = false;
        try { rec?.stop(); } catch { /* sudah berhenti */ }
        rec = null;
    }

    return { available, start, stop, get active() { return active; } };
}
