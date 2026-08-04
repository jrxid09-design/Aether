import * as THREE from "../vendor/three.module.js";

/**
 * Aether Entity — minibot holografik (manifestasi AI Core).
 *
 * Mengikuti patokan desain: kepala membulat besar dgn VISOR gelap mengkilap +
 * SEPASANG MATA CYAN BESAR, ear-cup di kiri-kanan, antena mungil; badan
 * TETESAN translusen yang meruncing ke bawah — ujungnya memancarkan BEAM ke
 * PANGGUNG PROYEKTOR (cincin konsentris); dikelilingi CINCIN KONSTELASI.
 *
 * AI CORE = inti energi di DALAM badan (bukan bola melayang terpisah). Saat
 * reasoning berat, badan meredup & core membesar menembusnya.
 *
 * WAJAH INTERAKTIF: mata & kepala mengikuti kursor, berkedip, dan berekspresi
 * per keadaan (menyimak = membelalak, senang = menyipit, berpikir = menengadah).
 *
 * Warna = keadaan: cyan=info/idle, purple=reasoning, orange=executing,
 * green=ok, red=danger. Hemat daya: cap fps, jeda saat tersembunyi.
 *
 * Interface stabil: el, setState, setLevel, setMouth, pause, resume, destroy.
 */

const STATES = ["idle", "listening", "thinking", "reasoning", "executing", "speaking", "happy", "success", "error", "offline"];

const COL = {
    idle:      0x35d6f0,
    listening: 0x5fe4fb,
    thinking:  0x9d6bff,
    reasoning: 0x9d6bff,
    executing: 0xff9d4a,
    speaking:  0x35d6f0,
    happy:     0x34d399,
    success:   0x34d399,
    error:     0xff5470,
    offline:   0x39435e
};

export function createHologram({ maxFps = 30 } = {}) {

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    wrap.style.cursor = "pointer";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(320, 320);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0.3, 6.6);
    camera.lookAt(0, -0.25, 0);

    // Pencahayaan lembut: kunci cyan, rim ungu (calm, premium).
    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.PointLight(0x8fd8ff, 22, 30); key.position.set(-3.4, 2.6, 4.6); scene.add(key);
    const rim = new THREE.PointLight(0x9d6bff, 9, 30); rim.position.set(3.2, -0.8, 2.8); scene.add(rim);
    const fill = new THREE.PointLight(0xdfefff, 12, 30); fill.position.set(2.4, 1.2, 4.2); scene.add(fill);
    const top = new THREE.DirectionalLight(0xffffff, 0.55); top.position.set(0, 5, 3); scene.add(top);

    // Root (skala global agar seluruh komposisi pas di frame).
    const root = new THREE.Group();
    root.scale.setScalar(0.9);
    scene.add(root);

    const entity = new THREE.Group();
    root.add(entity);

    // ---- Material -------------------------------------------------
    const shellMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.18, metalness: 0.08,
        emissive: 0x5aa8e0, emissiveIntensity: 0.3, transparent: true, opacity: 1
    });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x070c17, roughness: 0.16, metalness: 0.32, transparent: true, opacity: 1 });
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xe4f0ff, roughness: 0.22, metalness: 0.28, emissive: 0x2e6f9e, emissiveIntensity: 0.22, transparent: true, opacity: 1 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 1 });
    const eyeHaloMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

    // =============================================================
    // KEPALA — membulat, visor gelap, mata besar, ear-cup, antena
    // =============================================================
    const headPivot = new THREE.Group();
    headPivot.position.y = 0.55;
    entity.add(headPivot);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 48), shellMat);
    head.scale.set(1.06, 1, 0.97);
    headPivot.add(head);

    // Visor: PANEL gelap kecil di area mata (bukan topeng seluruh muka).
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.62, 44, 44), visorMat);
    visor.scale.set(1.05, 0.66, 0.5);
    visor.position.set(0, -0.02, 0.56);
    headPivot.add(visor);

    // --- MATA BESAR (ciri utama referensi) ---
    const eyeGeo = new THREE.SphereGeometry(0.19, 30, 30);
    const haloGeo = new THREE.SphereGeometry(0.26, 20, 20);
    const glintGeo = new THREE.SphereGeometry(0.046, 12, 12);

    function makeEye(x) {
        const g = new THREE.Group();
        g.position.set(x, 0.02, 0.85);
        const ball = new THREE.Mesh(eyeGeo, eyeMat.clone());
        ball.scale.set(1, 1.15, 0.42);
        g.add(ball);
        const halo = new THREE.Mesh(haloGeo, eyeHaloMat.clone());
        halo.scale.set(0.86, 1.0, 0.2);          // jangan melampaui tepi visor
        halo.position.z = -0.03;
        g.add(halo);
        const glint = new THREE.Mesh(glintGeo, glintMat);
        glint.position.set(0.06, 0.08, 0.1);
        g.add(glint);
        headPivot.add(g);
        return { g, ball, halo, glint, baseX: x };
    }
    const eyes = [makeEye(-0.28), makeEye(0.28)];

    // --- Ear-cup kiri & kanan ---
    function makeCup(x) {
        const g = new THREE.Group();
        g.position.set(x, 0.0, 0);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 26), cupMat);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
        const glowMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 30), glowMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = x > 0 ? 0.08 : -0.08;
        g.add(ring);
        headPivot.add(g);
        return { g, ring, glowMat };
    }
    const cups = [makeCup(-0.92), makeCup(0.92)];

    // --- Antena mungil ---
    const antMat = new THREE.MeshStandardMaterial({ color: 0xc7dcff, roughness: 0.35, metalness: 0.5 });
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), antMat);
    antenna.position.set(0, 1.0, 0);
    headPivot.add(antenna);
    const tipMat = new THREE.MeshBasicMaterial({ color: COL.idle });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 16), tipMat);
    tip.position.set(0, 1.19, 0);
    headPivot.add(tip);

    // =============================================================
    // BADAN — tetesan translusen meruncing (sumber beam)
    // =============================================================
    // Lonceng LEBAR & PENDEK (≈83% lebar kepala): kubah membulat di atas,
    // melengkung mulus meruncing ke ujung (sumber beam). Profil dihaluskan
    // lewat CatmullRom agar TIDAK bersegi/berlipat seperti permata.
    const bodyCtrl = [
        [0.00, 0.44], [0.18, 0.435], [0.40, 0.38], [0.62, 0.26], [0.75, 0.04],
        [0.70, -0.22], [0.54, -0.48], [0.32, -0.70], [0.13, -0.84], [0.00, -0.90]
    ].map(([x, y]) => new THREE.Vector3(x, y, 0));

    const bodyProfile = new THREE.CatmullRomCurve3(bodyCtrl, false, "catmullrom", 0.4)
        .getPoints(52)
        .map(p => new THREE.Vector2(Math.max(0, p.x), p.y));

    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xbde7ff, roughness: 0.22, metalness: 0.15,
        emissive: COL.idle, emissiveIntensity: 0.55,
        transparent: true, opacity: 0.82
    });
    const bodyGroup = new THREE.Group();
    bodyGroup.position.y = -0.86;      // rapat di bawah kepala (celah utk orbit)
    entity.add(bodyGroup);

    const body = new THREE.Mesh(new THREE.LatheGeometry(bodyProfile, 44), bodyMat);
    bodyGroup.add(body);

    // AI CORE — inti energi DI DALAM badan (menyala menembus).
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 24), coreMat);
    core.position.y = -0.5;            // dekat ujung → menyatu jadi sumber beam
    bodyGroup.add(core);

    const coreGlowMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 22, 22), coreGlowMat);
    coreGlow.position.copy(core.position);
    coreGlow.scale.set(1.3, 1, 1.3);
    bodyGroup.add(coreGlow);

    // Cincin energi mengorbit core (menyala saat reasoning).
    const coreRingMat = new THREE.MeshBasicMaterial({ color: COL.reasoning, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.011, 8, 56), coreRingMat);
    coreRing.position.copy(core.position);
    coreRing.rotation.x = Math.PI / 2;
    bodyGroup.add(coreRing);

    // =============================================================
    // PANGGUNG PROYEKTOR + BEAM (di root, tak ikut goyang entitas)
    // =============================================================
    const stage = new THREE.Group();
    stage.position.y = -2.02;
    root.add(stage);

    const plats = [];
    for (let i = 0; i < 4; i++) {
        const m = new THREE.MeshBasicMaterial({
            color: COL.idle, transparent: true, opacity: 0.5 - i * 0.08,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.46, 0.014, 8, 96), m);
        ring.rotation.x = Math.PI / 2;
        stage.add(ring);
        plats.push({ ring, m, base: 0.5 - i * 0.08 });
    }

    // Beam kerucut dari ujung badan ke panggung.
    const beamMat = new THREE.MeshBasicMaterial({
        color: COL.idle, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 26, 1, true), beamMat);
    beam.position.y = 0.59;            // relatif panggung → menyentuh ujung badan
    stage.add(beam);

    // Titik terang di pusat panggung.
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), spotMat);
    spot.rotation.x = -Math.PI / 2;
    spot.position.y = 0.005;
    stage.add(spot);

    // =============================================================
    // CINCIN KONSTELASI — group SENDIRI (bug lama: ikut rotasi entitas)
    // =============================================================
    const constGroup = new THREE.Group();
    root.add(constGroup);

    const R = 2.15;
    const constRingMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.3 });
    const constRing = new THREE.Mesh(new THREE.TorusGeometry(R, 0.005, 6, 128), constRingMat);
    constGroup.add(constRing);

    const DOTS = 42;
    const dotPos = new Float32Array(DOTS * 3);
    for (let i = 0; i < DOTS; i++) {
        const a = (i / DOTS) * Math.PI * 2;
        dotPos[i * 3] = Math.cos(a) * R;
        dotPos[i * 3 + 1] = Math.sin(a) * R;
        dotPos[i * 3 + 2] = 0;
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.BufferAttribute(dotPos, 3));
    const dotMat = new THREE.PointsMaterial({ color: COL.idle, size: 0.065, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    constGroup.add(new THREE.Points(dotGeo, dotMat));

    // Dua elips orbit tipis (kesan 3D mengelilingi bot).
    // Lewat di CELAH antara kepala & badan (jangan memotong wajah).
    const orbMatA = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    const orbitA = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.006, 6, 90), orbMatA);
    orbitA.rotation.x = Math.PI / 2.3;
    orbitA.position.y = -0.40;
    entity.add(orbitA);
    const orbMatB = new THREE.MeshBasicMaterial({ color: 0x9d6bff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    const orbitB = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.005, 6, 90), orbMatB);
    orbitB.rotation.x = Math.PI / 2.75;
    orbitB.rotation.z = 0.35;
    orbitB.position.y = -0.46;
    entity.add(orbitB);

    // Debu partikel halus (calm = sedikit).
    const PCOUNT = 80;
    const pPos = new Float32Array(PCOUNT * 3);
    for (let i = 0; i < PCOUNT; i++) {
        const r = 1.7 + Math.random() * 1.5, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        pPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.8;
        pPos[i * 3 + 2] = r * Math.cos(ph);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: COL.idle, size: 0.022, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const particles = new THREE.Points(pGeo, pMat);
    root.add(particles);

    // =============================================================
    // Keadaan + INTERAKSI (wajah mengikuti kursor)
    // =============================================================
    let state = "idle";
    let level = 0, levelSmooth = 0;
    let flash = 0, intro = 0, blink = 0, bounce = 0;
    let hovering = false;
    const look = { x: 0, y: 0 };
    const gaze = { x: 0, y: 0 };
    const target = new THREE.Color(COL.idle);
    const cur = new THREE.Color(COL.idle);
    const clock = new THREE.Clock();

    function onPointerMove(e) {
        const r = wrap.getBoundingClientRect();
        if (!r.width) return;
        look.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        look.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    }
    function onEnter() { hovering = true; }
    function onLeave() { hovering = false; look.x = 0; look.y = 0; }
    function onDown() { bounce = 1; }
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerenter", onEnter);
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("pointerdown", onDown);

    function setState(next) {
        if (!STATES.includes(next)) return;
        if (next !== state) flash = 1;
        state = next;
        target.set(COL[next] ?? COL.idle);
    }
    function setLevel(v) { level = Math.max(0, Math.min(1, v || 0)); }

    function applyColor(c) {
        for (const e of eyes) { e.ball.material.color.copy(c); e.halo.material.color.copy(c); }
        for (const cp of cups) cp.glowMat.color.copy(c);
        tipMat.color.copy(c);
        bodyMat.emissive.copy(c);
        coreGlowMat.color.copy(c);
        beamMat.color.copy(c);
        spotMat.color.copy(c);
        for (const p of plats) p.m.color.copy(c);
        constRingMat.color.copy(c); dotMat.color.copy(c); pMat.color.copy(c); orbMatA.color.copy(c);
    }

    // ---- Loop hemat daya -----------------------------------------
    let rafId = 0, acc = 0, destroyed = false;
    const MIN = 1 / maxFps;

    function tick() {
        rafId = requestAnimationFrame(tick);
        acc += clock.getDelta();
        if (acc < MIN) return;
        const dt = Math.min(0.06, acc);
        acc = 0;
        const t = clock.getElapsedTime();

        cur.lerp(target, Math.min(1, dt * 4));
        applyColor(cur);

        levelSmooth += (level - levelSmooth) * Math.min(1, dt * 12);
        flash += (0 - flash) * Math.min(1, dt * 3);
        intro += (1 - intro) * Math.min(1, dt * 2.4);
        bounce += (0 - bounce) * Math.min(1, dt * 4);

        const reasoning = state === "thinking" || state === "reasoning";
        const executing = state === "executing";
        const busy = reasoning || executing || state === "listening" || state === "speaking";
        const energy = levelSmooth + flash * 0.5 + (reasoning ? 0.3 : 0);
        const offline = state === "offline";

        // Melayang tenang + lonjakan kecil saat disentuh.
        entity.position.y = Math.sin(t * (busy ? 1.25 : 0.8)) * (busy ? 0.075 : 0.055) + bounce * 0.18;
        entity.scale.setScalar(0.55 + intro * 0.45);

        // --- WAJAH INTERAKTIF: menoleh & menatap kursor ---
        gaze.x += (look.x - gaze.x) * Math.min(1, dt * 5);
        gaze.y += (look.y - gaze.y) * Math.min(1, dt * 5);
        const swayY = hovering ? 0 : Math.sin(t * 0.45) * 0.13;
        const swayX = hovering ? 0 : Math.sin(t * 0.7) * 0.035;
        headPivot.rotation.y = gaze.x * 0.52 + swayY;
        headPivot.rotation.x = gaze.y * 0.3 + swayX + (reasoning ? -0.13 : 0);   // berpikir → menengadah
        headPivot.rotation.z = reasoning ? Math.sin(t * 1.8) * 0.05 : gaze.x * -0.06;
        bodyGroup.rotation.y = gaze.x * 0.18;

        // Kedip berkala.
        blink += dt;
        let lid = 1;
        if (blink > 3.8) {
            const p = (blink - 3.8) / 0.13;
            lid = p < 1 ? Math.abs(Math.cos(p * Math.PI)) : 1;
            if (blink > 3.93) blink = 0;
        }

        // Ekspresi per keadaan.
        let openY = 1.12, openX = 1;
        if (state === "listening") { openY = 1.32; openX = 1.06; }
        else if (state === "happy" || state === "success") { openY = 0.4; }
        else if (reasoning) { openY = 0.94; }
        else if (state === "error") { openY = 0.78; }
        else if (offline) { openY = 0.16; }
        if (hovering) openY *= 1.06;

        for (const e of eyes) {
            e.g.position.x = e.baseX + gaze.x * 0.045;
            e.g.position.y = 0.05 - gaze.y * 0.035;
            e.ball.scale.set(openX, openY * lid, 0.42);
            e.halo.scale.set(openX * 0.86, openY * lid * 0.9, 0.2);
            e.ball.material.opacity = offline ? 0.35 : 1;
            e.halo.material.opacity = (offline ? 0.08 : 0.3 + energy * 0.4) * intro;
            e.glint.visible = !offline && lid > 0.5;
            e.glint.position.x = (e.baseX > 0 ? 0.07 : 0.07) - gaze.x * 0.02;
        }

        // Ear-cup berdenyut saat menyimak.
        for (const cp of cups) {
            const on = state === "listening" ? 0.9 : busy ? 0.6 : 0.35;
            cp.glowMat.opacity = (on + Math.sin(t * (state === "listening" ? 6 : 2)) * 0.15) * intro;
            cp.ring.scale.setScalar(1 + (state === "listening" ? Math.sin(t * 6) * 0.12 : 0));
        }

        // Antena berdenyut.
        tip.scale.setScalar(1 + Math.sin(t * (busy ? 6 : 2.2)) * (busy ? 0.32 : 0.1) + energy * 0.3);

        // Badan: meredup saat reasoning agar CORE terlihat menembus.
        const bodyOpacity = (reasoning ? 0.42 : 0.82) * (offline ? 0.5 : 1);
        bodyMat.opacity += (bodyOpacity * intro - bodyMat.opacity) * 0.08;
        bodyMat.emissiveIntensity = 0.45 + energy * 0.6 + Math.sin(t * 2) * 0.06;
        shellMat.opacity += ((offline ? 0.75 : 1) * intro - shellMat.opacity) * 0.1;

        // AI Core.
        core.scale.setScalar(1 + Math.sin(t * 3) * 0.07 + energy * 1.5);
        coreMat.opacity = (0.22 + energy * 0.7) * intro;              // samar saat idle
        const cg = 1 + energy * 1.5 + (reasoning ? 0.55 : 0);
        coreGlow.scale.set(cg * 1.3, cg, cg * 1.3);       // melebar, menyatu ke badan
        coreGlowMat.opacity = (0.2 + energy * 0.55) * intro;
        coreRing.rotation.z += dt * (reasoning ? 2.4 : 0.7);
        coreRing.rotation.x = Math.PI / 2 + Math.sin(t) * 0.28;
        coreRingMat.opacity = (reasoning ? 0.7 : executing ? 0.4 : 0) * intro;

        // Orbit tipis mengelilingi bot.
        orbitA.rotation.z += dt * (busy ? 0.5 : 0.22);
        orbitB.rotation.z -= dt * (busy ? 0.34 : 0.16);
        orbMatA.opacity = (0.35 + energy * 0.35) * intro;
        orbMatB.opacity = (0.28 + energy * 0.25) * intro;

        // Panggung proyektor.
        stage.rotation.y += dt * (executing ? 0.85 : busy ? 0.45 : 0.2);
        plats.forEach((p, i) => {
            const pulse = 0.5 + Math.sin(t * (executing ? 3 : 1.35) - i * 0.55) * 0.5;
            p.m.opacity = (p.base * (0.45 + pulse * 0.85) + energy * 0.18) * intro * (offline ? 0.35 : 1);
            p.ring.scale.setScalar(1 + pulse * (executing ? 0.055 : 0.02));
        });
        beamMat.opacity = ((offline ? 0.03 : 0.12) + energy * 0.16) * intro;
        spotMat.opacity = ((offline ? 0.1 : 0.4) + energy * 0.35) * intro;

        // Konstelasi (berputar pelan, selalu menghadap kamera).
        constGroup.rotation.z += dt * (busy ? 0.11 : 0.045);
        constRingMat.opacity = ((offline ? 0.1 : 0.28) + energy * 0.22) * intro;
        dotMat.opacity = ((offline ? 0.2 : 0.7) + Math.sin(t * 2) * 0.15) * intro;
        dotMat.size = 0.06 + energy * 0.03;

        // Debu.
        particles.rotation.y -= dt * (0.05 + energy * 0.22);
        pMat.opacity = ((offline ? 0.1 : 0.34) + energy * 0.3) * intro;
        pMat.size = 0.02 + energy * 0.018;

        renderer.render(scene, camera);
    }

    function start() { if (!rafId && !destroyed) { clock.getDelta(); rafId = requestAnimationFrame(tick); } }
    function stop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }

    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener("visibilitychange", onVis);

    const resize = () => {
        const w = wrap.clientWidth || 320, h = wrap.clientHeight || 320;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
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
            wrap.removeEventListener("pointermove", onPointerMove);
            wrap.removeEventListener("pointerenter", onEnter);
            wrap.removeEventListener("pointerleave", onLeave);
            wrap.removeEventListener("pointerdown", onDown);
            observer.disconnect();
            renderer.dispose(); renderer.forceContextLoss?.();
        }
    };
}

export { STATES };
