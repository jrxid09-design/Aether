import * as THREE from "../vendor/three.module.js";

/**
 * Aether Entity — manifestasi AI Core (bukan chatbot avatar).
 *
 * Referensi visi: entitas AI melayang di atas PANGGUNG PROYEKTOR holografik,
 * di dalam CINCIN KONSTELASI, dengan AI CORE bercahaya sebagai jantungnya.
 * Orb TIDAK hilang — ia tetap AI Core; tubuh hanyalah manifestasi. Saat
 * reasoning berat, tubuh meredup & core membesar jadi pusat energi.
 *
 * Warna = keadaan (semantik): cyan=info/idle, purple=reasoning, green=ok,
 * orange=processing/executing, red=danger. Calm saat idle, energetic saat
 * berpikir. Hemat daya: cap fps, jeda saat tersembunyi, satu instance aktif.
 *
 * Interface stabil (kompat pemakai lama): el, setState, setLevel, setMouth,
 * pause, resume, destroy.
 */

const STATES = ["idle", "listening", "thinking", "reasoning", "executing", "speaking", "happy", "success", "error", "offline"];

// Palet SEMANTIK — sinyal keadaan, bukan dekorasi.
const COL = {
    idle:      0x35d6f0,   // cyan  — info/tenang
    listening: 0x35d6f0,
    thinking:  0x9d6bff,   // purple — reasoning
    reasoning: 0x9d6bff,
    executing: 0xff9d4a,   // orange — processing
    speaking:  0x35d6f0,
    happy:     0x34d399,   // green — ok
    success:   0x34d399,
    error:     0xff5470,   // red — danger
    offline:   0x3a4660
};

export function createHologram({ maxFps = 30 } = {}) {

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(320, 320);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0.35, 6.4);
    camera.lookAt(0, -0.1, 0);

    // Cahaya lembut (calm) — kunci cyan, rim ungu.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.PointLight(0x35d6f0, 26, 30); keyLight.position.set(-3, 3, 5); scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x9d6bff, 20, 30); rimLight.position.set(3, -1, 3); scene.add(rimLight);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.5).translateY(4));

    const entity = new THREE.Group();
    scene.add(entity);

    // Material bersama.
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xeaf2ff, roughness: 0.35, metalness: 0.4, emissive: 0x0a1830, emissiveIntensity: 0.15, transparent: true, opacity: 1 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x0a1020, roughness: 0.1, metalness: 0.7 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x9fb4ff, roughness: 0.3, metalness: 0.6 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: COL.idle, emissive: COL.idle, emissiveIntensity: 3, roughness: 0.2 });

    // =============================================================
    // Manifestasi (tubuh): kepala membulat + visor + mata bercahaya,
    // badan tetesan terpisah — melayang. Elegan, bukan robot generik.
    // =============================================================
    const body = new THREE.Group();
    entity.add(body);

    const headPivot = new THREE.Group();
    headPivot.position.y = 0.5;
    body.add(headPivot);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.92, 40, 40), shellMat);
    head.scale.set(1.08, 1, 0.98);
    headPivot.add(head);

    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.8, 36, 36), visorMat);
    visor.scale.set(1, 0.72, 0.6); visor.position.set(0, 0.02, 0.44);
    headPivot.add(visor);

    const eyeGeo = new THREE.SphereGeometry(0.14, 22, 22);
    const makeEye = (x) => { const e = new THREE.Mesh(eyeGeo, eyeMat.clone()); e.scale.z = 0.6; e.position.set(x, 0.04, 0.72); headPivot.add(e); return e; };
    const eyes = [makeEye(-0.28), makeEye(0.28)];

    // Antena halus + bohlam.
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.34, 8), accentMat);
    antenna.position.set(0, 1.05, 0); headPivot.add(antenna);
    const bulbMat = new THREE.MeshStandardMaterial({ color: COL.idle, emissive: COL.idle, emissiveIntensity: 2.6 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 14), bulbMat);
    bulb.position.set(0, 1.26, 0); headPivot.add(bulb);

    // Badan tetesan (terpisah dari kepala → kesan melayang).
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.6, 36, 36), shellMat);
    torso.scale.set(1, 1.15, 0.95); torso.position.y = -0.72;
    body.add(torso);

    // =============================================================
    // AI CORE — jantung energi (orb tetap identitas).
    // =============================================================
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), coreMat);
    core.position.y = -0.4; entity.add(core);

    const coreGlowMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 24), coreGlowMat);
    coreGlow.position.copy(core.position); entity.add(coreGlow);

    // Cincin energi mengorbit core (aktif saat reasoning).
    const coreRingMat = new THREE.MeshBasicMaterial({ color: COL.reasoning, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.01, 8, 60), coreRingMat);
    coreRing.position.copy(core.position); coreRing.rotation.x = Math.PI / 2; entity.add(coreRing);

    // =============================================================
    // PANGGUNG PROYEKTOR — cincin holografik konsentris + beam.
    // =============================================================
    const stage = new THREE.Group();
    stage.position.y = -1.75; scene.add(stage);

    const platMats = [];
    for (let i = 0; i < 4; i++) {
        const m = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.5 - i * 0.09, blending: THREE.AdditiveBlending, depthWrite: false });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7 + i * 0.5, 0.012, 8, 90), m);
        ring.rotation.x = Math.PI / 2; stage.add(ring); platMats.push({ ring, m, base: 0.5 - i * 0.09 });
    }

    // Beam proyeksi (kerucut) dari panggung ke entitas.
    const beamMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 24, 1, true), beamMat);
    beam.position.y = 0.8; stage.add(beam);

    // =============================================================
    // CINCIN KONSTELASI — lingkaran + titik bintang (menghadap kamera).
    // =============================================================
    const constGroup = new THREE.Group();
    entity.add(constGroup);
    const constRing = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.004, 6, 120),
        new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.35 }));
    constGroup.add(constRing);

    const DOTS = 46;
    const dotPos = new Float32Array(DOTS * 3);
    for (let i = 0; i < DOTS; i++) {
        const a = (i / DOTS) * Math.PI * 2;
        dotPos[i * 3] = Math.cos(a) * 2.5; dotPos[i * 3 + 1] = Math.sin(a) * 2.5; dotPos[i * 3 + 2] = 0;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
    const dotMat = new THREE.PointsMaterial({ color: COL.idle, size: 0.06, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    constGroup.add(new THREE.Points(dotGeo, dotMat));

    // Partikel debu halus (calm = sedikit).
    const PCOUNT = 90;
    const pPos = new Float32Array(PCOUNT * 3);
    for (let i = 0; i < PCOUNT; i++) {
        const r = 1.6 + Math.random() * 1.6, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        pPos[i * 3] = r * Math.sin(ph) * Math.cos(th); pPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.7; pPos[i * 3 + 2] = r * Math.cos(ph);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: COL.idle, size: 0.02, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // =============================================================
    // Keadaan hidup.
    // =============================================================
    let state = "idle";
    let level = 0, levelSmooth = 0;
    let flash = 0, intro = 0, blink = 0;
    const target = new THREE.Color(COL.idle);
    const cur = new THREE.Color(COL.idle);
    const clock = new THREE.Clock();

    function setState(next) {
        if (!STATES.includes(next)) return;
        if (next !== state) flash = 1;
        state = next;
        target.set(COL[next] ?? COL.idle);
    }
    function setLevel(v) { level = Math.max(0, Math.min(1, v || 0)); }

    function applyColor(c) {
        for (const e of eyes) { e.material.color.copy(c); e.material.emissive.copy(c); }
        bulbMat.color.copy(c); bulbMat.emissive.copy(c);
        coreGlowMat.color.copy(c); coreRingMat.color.copy(c);
        for (const p of platMats) p.m.color.copy(c);
        beamMat.color.copy(c); constRing.material.color.copy(c); dotMat.color.copy(c); pMat.color.copy(c);
    }

    // ---- Loop hemat daya (cap fps + jeda) ------------------------
    let rafId = 0, acc = 0, destroyed = false;
    const MIN = 1 / maxFps;

    function tick() {
        rafId = requestAnimationFrame(tick);
        acc += clock.getDelta();
        if (acc < MIN) return;
        const dt = Math.min(0.06, acc);
        acc = 0;
        const t = clock.getElapsedTime();

        cur.lerp(target, Math.min(1, dt * 4)); applyColor(cur);
        levelSmooth += (level - levelSmooth) * Math.min(1, dt * 12);
        flash += (0 - flash) * Math.min(1, dt * 3);
        intro += (1 - intro) * Math.min(1, dt * 2.2);

        const reasoning = state === "thinking" || state === "reasoning";
        const executing = state === "executing";
        const busy = reasoning || executing || state === "listening" || state === "speaking";
        const energy = levelSmooth + flash * 0.5 + (reasoning ? 0.35 : 0);

        // Melayang tenang; saat reasoning sedikit lebih “bernapas”.
        entity.position.y = Math.sin(t * (busy ? 1.3 : 0.8)) * (busy ? 0.09 : 0.06);
        entity.rotation.y = Math.sin(t * 0.25) * 0.12;
        entity.scale.setScalar(0.55 + intro * 0.45);

        // Kepala: celingak halus + kedip.
        headPivot.rotation.y = Math.sin(t * 0.5) * 0.14;
        headPivot.rotation.z = Math.sin(t * 0.35) * 0.05;
        blink += dt; let eyeSc = 1;
        if (blink > 3.6) { const p = (blink - 3.6) / 0.13; eyeSc = p < 1 ? Math.abs(Math.cos(p * Math.PI)) : 1; if (blink > 3.73) blink = 0; }
        const eyeOpen = state === "listening" ? 1.15 : state === "happy" || state === "success" ? 0.5 : 1;
        for (const e of eyes) { e.scale.y = 0.6 * eyeOpen * eyeSc; e.material.emissiveIntensity = 2.6 + levelSmooth * 2 + flash; }

        // Reasoning berat: tubuh MEREDUP, core MEMBESAR jadi pusat energi.
        const dissolve = reasoning ? 0.55 : 1;
        shellMat.opacity += (dissolve * intro - shellMat.opacity) * 0.08;
        core.scale.setScalar(1 + Math.sin(t * 3) * 0.08 + energy * 1.4);
        coreMat.opacity = 0.85 + levelSmooth * 0.15;
        coreGlow.scale.setScalar(1 + energy * 1.6 + (reasoning ? 0.6 : 0));
        coreGlowMat.opacity = (0.35 + energy * 0.5) * intro;
        coreRing.rotation.z += dt * (reasoning ? 2.4 : 0.6);
        coreRing.rotation.x = Math.PI / 2 + Math.sin(t) * 0.3;
        coreRingMat.opacity = (reasoning ? 0.7 : executing ? 0.4 : 0) * intro;
        bulb.scale.setScalar(1 + Math.sin(t * (busy ? 6 : 2.2)) * (busy ? 0.3 : 0.08));

        // Panggung: cincin berputar & berdenyut (lebih cepat saat sibuk/exec).
        stage.rotation.y += dt * (executing ? 0.9 : busy ? 0.5 : 0.22);
        platMats.forEach((p, i) => {
            const pulse = 0.5 + Math.sin(t * (executing ? 3 : 1.4) - i * 0.6) * 0.5;
            p.m.opacity = (p.base * (0.5 + pulse * 0.8) + energy * 0.2) * intro;
            p.ring.scale.setScalar(1 + pulse * (executing ? 0.06 : 0.02));
        });
        beamMat.opacity = (0.08 + energy * 0.18 + (busy ? 0.05 : 0)) * intro;

        // Konstelasi berputar sangat pelan (calm).
        constGroup.rotation.z += dt * (busy ? 0.12 : 0.05);
        constRing.material.opacity = (0.3 + energy * 0.25) * intro;
        dotMat.opacity = (0.7 + Math.sin(t * 2) * 0.2) * intro;
        dotMat.size = 0.055 + energy * 0.03;

        // Partikel: sedikit saat idle, meningkat saat berpikir.
        particles.rotation.y -= dt * (0.05 + energy * 0.25);
        pMat.opacity = ((state === "offline" ? 0.12 : 0.35) + energy * 0.35) * intro;
        pMat.size = 0.018 + energy * 0.02;

        // Redup menyeluruh saat offline.
        const dim = state === "offline" ? 0.4 : 1;
        entity.scale.multiplyScalar(1);
        renderer.render(scene, camera);
        void dim;
    }

    function start() { if (!rafId && !destroyed) { clock.getDelta(); rafId = requestAnimationFrame(tick); } }
    function stop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener("visibilitychange", onVis);

    const resize = () => {
        const w = wrap.clientWidth || 320, h = wrap.clientHeight || 320;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    setTimeout(resize, 0);

    start();

    return {
        el: wrap,
        setState,
        setLevel,
        setMouth: setLevel,
        get state() { return state; },
        pause: stop,
        resume: () => { if (!document.hidden) start(); },
        destroy() {
            destroyed = true; stop();
            document.removeEventListener("visibilitychange", onVis);
            observer.disconnect();
            renderer.dispose(); renderer.forceContextLoss?.();
        }
    };
}

export { STATES };
