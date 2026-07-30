/**
 * Avatar minibot Aether.
 *
 * Sebuah karakter SVG kecil yang "hidup": mengambang pelan,
 * berkedip, dan berganti ekspresi mengikuti keadaan percakapan.
 * Ini murni antarmuka — keputusan tetap dari sistem AI di
 * belakangnya — tapi kehadirannya yang membuat Aether terasa
 * sebagai entitas, bukan kotak teks.
 *
 * Pemakaian:
 *   const bot = createAvatar();
 *   container.appendChild(bot.el);
 *   bot.setState("listening");
 *   bot.setMouth(0.7);           // saat bicara, ikut amplitudo
 *
 * State: idle | listening | thinking | speaking | happy | error | offline
 */

export const STATES = [
    "idle", "listening", "thinking", "speaking", "happy", "error", "offline"
];

let styleInjected = false;

function injectStyle() {

    if (styleInjected) {
        return;
    }

    styleInjected = true;

    const css = `
    .aether-avatar {
        --a1: var(--accent-1, #22d3ee);
        --a2: var(--accent-2, #7c8cff);
        --a3: var(--accent-3, #c084fc);
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
    }

    /* Seluruh badan mengambang pelan — tanda "hidup". */
    .aether-avatar .body {
        transform-box: fill-box;
        transform-origin: center;
        animation: aa-float 4.5s ease-in-out infinite;
    }
    @keyframes aa-float {
        0%,100% { transform: translateY(0); }
        50%     { transform: translateY(-6px); }
    }

    /* Cincin aura di belakang kepala; menyala saat mendengar. */
    .aether-avatar .aura {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: center;
        transition: opacity .4s ease;
    }
    .aether-avatar.is-listening .aura,
    .aether-avatar.is-speaking .aura { opacity: .9; }
    .aether-avatar.is-listening .aura { animation: aa-aura 1.8s ease-in-out infinite; }
    @keyframes aa-aura {
        0%,100% { transform: scale(1);   opacity:.35; }
        50%     { transform: scale(1.12); opacity:.85; }
    }

    /* Antena berdenyut saat mendengar / berpikir. */
    .aether-avatar .antenna-bulb {
        transform-box: fill-box;
        transform-origin: center;
    }
    .aether-avatar.is-listening .antenna-bulb,
    .aether-avatar.is-thinking .antenna-bulb {
        animation: aa-bulb 1.1s ease-in-out infinite;
    }
    @keyframes aa-bulb {
        0%,100% { opacity:.5; transform: scale(.85); }
        50%     { opacity:1;  transform: scale(1.15); }
    }

    /* Mata: kedip berkala + variasi bentuk per-state. */
    .aether-avatar .eye {
        transform-box: fill-box;
        transform-origin: center;
        animation: aa-blink 5s infinite;
    }
    @keyframes aa-blink {
        0%,94%,100% { transform: scaleY(1); }
        97%         { transform: scaleY(.1); }
    }
    .aether-avatar.is-thinking .eyes { transform: translateY(-5px); }
    .aether-avatar.is-listening .eye { transform: scale(1.15); }
    .aether-avatar .eyes { transition: transform .3s ease; }

    /* Set mata alternatif (happy ^^ / error ><) disembunyikan default. */
    .aether-avatar .eyes-happy,
    .aether-avatar .eyes-error { opacity: 0; }
    .aether-avatar.is-happy .eyes-open,
    .aether-avatar.is-error .eyes-open { opacity: 0; }
    .aether-avatar.is-happy .eyes-happy { opacity: 1; }
    .aether-avatar.is-error .eyes-error { opacity: 1; }

    /* Mulut: bentuk berganti; saat bicara tingginya diatur JS. */
    .aether-avatar .mouth { transition: all .18s ease; }
    .aether-avatar .mouth-neutral { opacity: 1; }
    .aether-avatar .mouth-smile,
    .aether-avatar .mouth-speak,
    .aether-avatar .mouth-flat { opacity: 0; }
    .aether-avatar.is-happy .mouth-neutral { opacity: 0; }
    .aether-avatar.is-happy .mouth-smile { opacity: 1; }
    .aether-avatar.is-speaking .mouth-neutral { opacity: 0; }
    .aether-avatar.is-speaking .mouth-speak { opacity: 1; }
    .aether-avatar.is-error .mouth-neutral { opacity: 0; }
    .aether-avatar.is-error .mouth-flat { opacity: 1; }

    /* Titik "berpikir". */
    .aether-avatar .think-dots { opacity: 0; transition: opacity .3s ease; }
    .aether-avatar.is-thinking .think-dots { opacity: 1; }
    .aether-avatar .think-dots circle { animation: aa-dot 1.2s infinite; }
    .aether-avatar .think-dots circle:nth-child(2) { animation-delay: .2s; }
    .aether-avatar .think-dots circle:nth-child(3) { animation-delay: .4s; }
    @keyframes aa-dot {
        0%,100% { opacity:.25; transform: translateY(0); }
        50%     { opacity:1;   transform: translateY(-3px); }
    }
    .aether-avatar .think-dots circle {
        transform-box: fill-box;
        transform-origin: center;
    }

    /* Redup saat offline. */
    .aether-avatar.is-offline { filter: grayscale(.85) brightness(.7); opacity: .6; }
    .aether-avatar.is-offline .body { animation: none; }

    @media (prefers-reduced-motion: reduce) {
        .aether-avatar * { animation: none !important; }
    }`;

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

}

const SVG = `
<svg class="aether-avatar" viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Aether">
  <defs>
    <linearGradient id="aa-head" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"  stop-color="var(--a2)"/>
      <stop offset="100%" stop-color="var(--a3)"/>
    </linearGradient>
    <radialGradient id="aa-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0%"  stop-color="var(--a1)" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="var(--a2)" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="var(--a2)" stop-opacity="0"/>
    </radialGradient>
    <filter id="aa-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <circle class="aura" cx="100" cy="112" r="82" fill="url(#aa-aura)"/>

  <g class="body">
    <!-- antena -->
    <line x1="100" y1="46" x2="100" y2="28" stroke="var(--a1)" stroke-width="3" stroke-linecap="round"/>
    <circle class="antenna-bulb" cx="100" cy="24" r="6" fill="var(--a1)" filter="url(#aa-glow)"/>

    <!-- telinga/baut samping -->
    <rect x="20"  y="96" width="12" height="34" rx="6" fill="var(--a2)" opacity="0.55"/>
    <rect x="168" y="96" width="12" height="34" rx="6" fill="var(--a2)" opacity="0.55"/>

    <!-- kepala -->
    <rect x="34" y="48" width="132" height="124" rx="40" fill="url(#aa-head)"/>
    <rect x="34" y="48" width="132" height="124" rx="40" fill="none" stroke="var(--a1)" stroke-width="1.5" opacity="0.5"/>

    <!-- layar wajah -->
    <rect x="52" y="74" width="96" height="78" rx="26" fill="#05060c" opacity="0.9"/>

    <!-- mata -->
    <g class="eyes">
      <g class="eyes-open">
        <rect class="eye" x="72"  y="98" width="16" height="22" rx="8" fill="var(--a1)" filter="url(#aa-glow)"/>
        <rect class="eye" x="112" y="98" width="16" height="22" rx="8" fill="var(--a1)" filter="url(#aa-glow)"/>
      </g>
      <g class="eyes-happy" fill="none" stroke="var(--a1)" stroke-width="4" stroke-linecap="round" filter="url(#aa-glow)">
        <path d="M72 112 q8 -12 16 0"/>
        <path d="M112 112 q8 -12 16 0"/>
      </g>
      <g class="eyes-error" fill="none" stroke="var(--danger, #fb7185)" stroke-width="4" stroke-linecap="round">
        <path d="M72 100 l16 16 M88 100 l-16 16"/>
        <path d="M112 100 l16 16 M128 100 l-16 16"/>
      </g>
    </g>

    <!-- mulut -->
    <g class="mouth">
      <rect class="mouth-neutral" x="88" y="132" width="24" height="4" rx="2" fill="var(--a1)" opacity="0.85"/>
      <path class="mouth-smile" d="M84 130 q16 16 32 0" fill="none" stroke="var(--a1)" stroke-width="4" stroke-linecap="round"/>
      <rect class="mouth-speak" x="90" y="130" width="20" height="8" rx="4" fill="var(--a1)" filter="url(#aa-glow)"/>
      <path class="mouth-flat" d="M86 134 q14 -8 28 0" fill="none" stroke="var(--danger, #fb7185)" stroke-width="3" stroke-linecap="round"/>
    </g>

    <!-- titik berpikir -->
    <g class="think-dots" fill="var(--a3)">
      <circle cx="90"  cy="134" r="3"/>
      <circle cx="100" cy="134" r="3"/>
      <circle cx="110" cy="134" r="3"/>
    </g>
  </g>
</svg>`;

export function createAvatar() {

    injectStyle();

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    wrap.innerHTML = SVG;

    const svg = wrap.querySelector("svg");
    const mouthSpeak = svg.querySelector(".mouth-speak");

    let state = "idle";
    let raf = null;

    // Geometri mulut bicara saat "tertutup" — dipakai untuk lerp.
    const baseY = 132;
    const baseH = 4;
    const maxH = 20;

    function setState(next) {

        if (!STATES.includes(next)) {
            return;
        }

        state = next;

        for (const s of STATES) {
            svg.classList.toggle(`is-${s}`, s === next);
        }

        // Berhenti menggerakkan mulut kalau bukan sedang bicara.
        if (next !== "speaking") {
            stopIdleMouth();
            setMouth(0);
        }
        else {
            startIdleMouth();
        }

    }

    /** Buka mulut 0..1 — dipanggil TTS mengikuti batas kata/amplitudo. */
    function setMouth(amount) {

        const a = Math.max(0, Math.min(1, amount || 0));
        const h = baseH + (maxH - baseH) * a;

        mouthSpeak.setAttribute("height", h.toFixed(1));
        mouthSpeak.setAttribute("y", (baseY + (baseH - h) / 2).toFixed(1));

    }

    // Saat bicara tanpa data amplitudo, mulut beroscilasi lembut
    // supaya tetap terlihat "ngomong".
    let idleMouthT = 0;
    function startIdleMouth() {
        if (raf) return;
        const tick = () => {
            idleMouthT += 0.35;
            const wobble = (Math.sin(idleMouthT) + 1) / 2;
            setMouth(0.25 + wobble * 0.5);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
    }

    function stopIdleMouth() {
        if (raf) {
            cancelAnimationFrame(raf);
            raf = null;
        }
    }

    setState("idle");

    return {
        el: wrap,
        svg,
        setState,
        setMouth,
        get state() { return state; },
        destroy() { stopIdleMouth(); }
    };

}
