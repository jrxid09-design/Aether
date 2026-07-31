import * as THREE from "../vendor/three.module.js";

/**
 * Minibot 3D Aether.
 *
 * Robot mungil yang gemas: kepala besar membulat dengan visor
 * mengkilap & sepasang mata bercahaya besar, badan chubby, tangan
 * kecil yang melambai, antena berdenyut, dan pipi merona. Ia
 * MENGIKUTI kursor (kepala & tatapan menoleh) dan bereaksi saat
 * disentuh kursor (melonjak senang).
 *
 * Antarmukanya SAMA dengan avatar SVG (createAvatar): el, setState,
 * setMouth, destroy — jadi layar Aether bisa menukar keduanya tanpa
 * perubahan lain. Bila WebGL tak tersedia, pembuatannya melempar
 * error dan pemanggil jatuh ke versi SVG.
 */

const STATES = [
    "idle", "listening", "thinking", "speaking", "happy", "error", "offline"
];

// Warna aurora (selaras dengan tema Console).
const C = {
    cyan: 0x22d3ee,
    blue: 0x7c8cff,
    purple: 0xc084fc,
    danger: 0xfb7185,
    ok: 0x34d399,
    blush: 0xff8fb3,
    shell: 0xeef2ff
};

export function createAvatar3D() {

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    wrap.style.cursor = "pointer";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(300, 300);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.2, 6.6);

    // ---- Pencahayaan (nuansa aurora, lembut) -------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const keyLight = new THREE.PointLight(C.cyan, 40, 30);
    keyLight.position.set(-4, 3, 5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(C.purple, 32, 30);
    rimLight.position.set(4, -2, 4);
    scene.add(rimLight);

    const topLight = new THREE.DirectionalLight(0xffffff, 0.7);
    topLight.position.set(0, 5, 2);
    scene.add(topLight);

    // ---- Material bersama --------------------------------------
    const shellMat = new THREE.MeshStandardMaterial({
        color: C.shell, roughness: 0.32, metalness: 0.35,
        emissive: C.blue, emissiveIntensity: 0.05
    });
    const accentMat = new THREE.MeshStandardMaterial({
        color: C.blue, roughness: 0.3, metalness: 0.6
    });
    const visorMat = new THREE.MeshStandardMaterial({
        color: 0x0a0e1a, roughness: 0.15, metalness: 0.6,
        emissive: 0x0a0e1a, emissiveIntensity: 0.2
    });

    // =====================================================================
    // Susunan: bot → { bodyGroup, headPivot → headGroup }
    // headPivot menoleh ke kursor tanpa mengganggu ayunan badan.
    // =====================================================================
    const bot = new THREE.Group();
    scene.add(bot);

    // ---- Badan (chubby) ----------------------------------------
    const bodyGroup = new THREE.Group();
    bot.add(bodyGroup);

    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.82, 0.5, 12, 32),
        shellMat
    );
    body.scale.set(1, 0.9, 0.9);
    body.position.y = -1.5;
    bodyGroup.add(body);

    // Panel dada bercahaya (indikator "detak").
    const chestMat = new THREE.MeshStandardMaterial({
        color: C.cyan, emissive: C.cyan, emissiveIntensity: 1.4, roughness: 0.3
    });
    const chest = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), chestMat);
    chest.position.set(0, -1.42, 0.74);
    bodyGroup.add(chest);

    // Tangan kecil (kapsul) — sedikit melambai.
    const armGeo = new THREE.CapsuleGeometry(0.12, 0.34, 6, 12);
    const leftArm = new THREE.Mesh(armGeo, accentMat);
    leftArm.position.set(-0.95, -1.5, 0.1);
    leftArm.rotation.z = 0.5;
    bodyGroup.add(leftArm);
    const rightArm = new THREE.Mesh(armGeo, accentMat);
    rightArm.position.set(0.95, -1.5, 0.1);
    rightArm.rotation.z = -0.5;
    bodyGroup.add(rightArm);

    // Kaki mungil.
    const footGeo = new THREE.SphereGeometry(0.22, 20, 20);
    const leftFoot = new THREE.Mesh(footGeo, accentMat);
    leftFoot.scale.set(1, 0.7, 1.2);
    leftFoot.position.set(-0.4, -2.25, 0.12);
    bodyGroup.add(leftFoot);
    const rightFoot = new THREE.Mesh(footGeo, accentMat);
    rightFoot.scale.set(1, 0.7, 1.2);
    rightFoot.position.set(0.4, -2.25, 0.12);
    bodyGroup.add(rightFoot);

    // ---- Kepala (besar & gemas) --------------------------------
    const headPivot = new THREE.Group();
    headPivot.position.y = 0.15;
    bot.add(headPivot);

    const headGroup = new THREE.Group();
    headPivot.add(headGroup);

    const head = new THREE.Mesh(
        new THREE.SphereGeometry(1.4, 48, 48),
        shellMat
    );
    head.scale.set(1.12, 1.02, 1);
    headGroup.add(head);

    // Visor gelap mengkilap di depan wajah.
    const visor = new THREE.Mesh(new THREE.SphereGeometry(1.18, 44, 44), visorMat);
    visor.scale.set(1, 0.82, 0.62);
    visor.position.set(0, 0.05, 0.62);
    headGroup.add(visor);

    // Mata: bola cyan bercahaya besar + kilau putih (highlight).
    const eyeMat = new THREE.MeshStandardMaterial({
        color: C.cyan, emissive: C.cyan, emissiveIntensity: 2.6, roughness: 0.25
    });
    const eyeGeo = new THREE.SphereGeometry(0.3, 28, 28);

    const eyesGroup = new THREE.Group();
    eyesGroup.position.set(0, 0.12, 1.02);
    headGroup.add(eyesGroup);

    const highlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const highlightGeo = new THREE.SphereGeometry(0.075, 12, 12);

    function makeEye(x) {
        const g = new THREE.Group();
        g.position.set(x, 0, 0);
        const ball = new THREE.Mesh(eyeGeo, eyeMat.clone());
        ball.scale.z = 0.6;
        g.add(ball);
        const hi = new THREE.Mesh(highlightGeo, highlightMat);
        hi.position.set(0.09, 0.1, 0.22);
        g.add(hi);
        g.userData = { ball, hi };
        eyesGroup.add(g);
        return g;
    }
    const leftEye = makeEye(-0.46);
    const rightEye = makeEye(0.46);
    const eyeBalls = [leftEye.userData.ball, rightEye.userData.ball];

    // Pipi merona (kegemasan).
    const blushMat = new THREE.MeshStandardMaterial({
        color: C.blush, emissive: C.blush, emissiveIntensity: 0.9,
        transparent: true, opacity: 0.75
    });
    const blushGeo = new THREE.CircleGeometry(0.16, 20);
    const leftBlush = new THREE.Mesh(blushGeo, blushMat);
    leftBlush.position.set(-0.72, -0.28, 1.02);
    headGroup.add(leftBlush);
    const rightBlush = new THREE.Mesh(blushGeo, blushMat.clone());
    rightBlush.position.set(0.72, -0.28, 1.02);
    headGroup.add(rightBlush);

    // Mulut (bercahaya; tinggi berubah saat bicara).
    const mouthMat = new THREE.MeshStandardMaterial({
        color: C.cyan, emissive: C.cyan, emissiveIntensity: 1.8
    });
    const mouth = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.07, 0.28, 4, 12), mouthMat
    );
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0, -0.46, 1.0);
    headGroup.add(mouth);

    // Antena + bohlam berdenyut.
    const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), accentMat
    );
    antenna.position.set(0, 1.55, 0);
    headGroup.add(antenna);

    const bulbMat = new THREE.MeshStandardMaterial({
        color: C.cyan, emissive: C.cyan, emissiveIntensity: 2.6
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), bulbMat);
    bulb.position.set(0, 1.9, 0);
    headGroup.add(bulb);

    // Telinga/earcup.
    const earGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.22, 24);
    const leftEar = new THREE.Mesh(earGeo, accentMat);
    leftEar.rotation.z = Math.PI / 2;
    leftEar.position.set(-1.44, -0.05, 0);
    headGroup.add(leftEar);
    const rightEar = new THREE.Mesh(earGeo, accentMat);
    rightEar.rotation.z = Math.PI / 2;
    rightEar.position.set(1.44, -0.05, 0);
    headGroup.add(rightEar);

    // Cincin aura (menyala saat mendengar/bicara).
    const ringMat = new THREE.MeshBasicMaterial({
        color: C.cyan, transparent: true, opacity: 0
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.03, 12, 64), ringMat);
    ring.position.set(0, 0.1, -0.3);
    bot.add(ring);

    // ---- State & interaksi -------------------------------------
    let state = "idle";
    let mouthTarget = 0;
    let mouthCurrent = 0;
    let blink = 0;
    let running = true;

    // Tatapan mengikuti kursor (dinormalisasi -1..1) + reaksi hover.
    const look = { x: 0, y: 0 };          // target
    const gaze = { x: 0, y: 0 };          // teranimasi (di-lerp)
    let hovering = false;
    let bounce = 0;                        // dorongan lompat saat disentuh

    const clock = new THREE.Clock();

    function onPointerMove(e) {
        const rect = wrap.getBoundingClientRect();
        if (!rect.width) return;
        look.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        look.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    }
    function onEnter() { hovering = true; bounce = 1; }
    function onLeave() { hovering = false; look.x = 0; look.y = 0; }

    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerenter", onEnter);
    wrap.addEventListener("pointerleave", onLeave);

    function setAccentColor(hex, intensity = 2.6) {
        for (const ball of eyeBalls) {
            ball.material.color.setHex(hex);
            ball.material.emissive.setHex(hex);
            ball.material.emissiveIntensity = intensity;
        }
        mouthMat.color.setHex(hex); mouthMat.emissive.setHex(hex);
        bulbMat.color.setHex(hex); bulbMat.emissive.setHex(hex);
        chestMat.color.setHex(hex); chestMat.emissive.setHex(hex);
        ringMat.color.setHex(hex);
    }

    function setState(next) {
        if (!STATES.includes(next)) return;
        state = next;

        if (next === "error") setAccentColor(C.danger, 2.4);
        else if (next === "happy") setAccentColor(C.ok, 2.8);
        else if (next === "listening") setAccentColor(C.cyan, 3.4);
        else setAccentColor(C.cyan, 2.6);

        if (next !== "speaking") mouthTarget = 0;
    }

    function setMouth(amount) {
        mouthTarget = Math.max(0, Math.min(1, amount || 0));
    }

    function frame() {
        if (!running) return;

        const t = clock.getElapsedTime();
        const dt = Math.min(0.05, clock.getDelta());

        // Lompatan kecil saat disentuh kursor mereda perlahan.
        bounce += (0 - bounce) * Math.min(1, dt * 4);

        // Mengambang & bernapas.
        if (state !== "offline") {
            bot.position.y = Math.sin(t * 1.6) * 0.08 + bounce * 0.25;
            const breathe = 1 + Math.sin(t * 1.6) * 0.015;
            bodyGroup.scale.setScalar(breathe);
        }

        // Kepala menoleh ke kursor (halus); saat idle sedikit celingak.
        gaze.x += (look.x - gaze.x) * Math.min(1, dt * 6);
        gaze.y += (look.y - gaze.y) * Math.min(1, dt * 6);

        const idleSwayY = hovering ? 0 : Math.sin(t * 0.6) * 0.14;
        const idleSwayX = hovering ? 0 : Math.sin(t * 0.9) * 0.04;
        headPivot.rotation.y = gaze.x * 0.6 + idleSwayY;
        headPivot.rotation.x = gaze.y * 0.4 + idleSwayX + (state === "thinking" ? -0.14 : 0);
        headPivot.rotation.z = state === "thinking" ? Math.sin(t * 2) * 0.06 : gaze.x * -0.05;

        // Badan ikut sedikit condong ke arah tatapan (hidup).
        bodyGroup.rotation.y = gaze.x * 0.15;

        // Tatapan mata (pupil/highlight geser) + tangan melambai.
        for (const eye of [leftEye, rightEye]) {
            eye.position.x = (eye === leftEye ? -0.46 : 0.46) + gaze.x * 0.06;
            eye.position.y = 0 - gaze.y * 0.05;
        }
        leftArm.rotation.z = 0.5 + Math.sin(t * 2.4) * 0.12;
        rightArm.rotation.z = -0.5 - Math.sin(t * 2.4 + 1) * 0.12;

        // Kedip berkala.
        blink += dt;
        let eyeScaleY = 1;
        if (blink > 3.4) {
            const p = (blink - 3.4) / 0.14;
            eyeScaleY = p < 1 ? Math.abs(Math.cos(p * Math.PI)) : 1;
            if (blink > 3.54) blink = 0;
        }

        // Ekspresi mata per-state.
        let baseY = 1, baseX = 1;
        if (state === "listening") { baseY = 1.2; baseX = 1.1; }
        if (state === "happy") { baseY = 0.45; }                 // mata menyipit ^_^
        if (state === "error") { baseY = 0.8; }
        for (const ball of eyeBalls) {
            ball.scale.y = baseY * eyeScaleY;
            ball.scale.x = baseX;
        }

        // Pipi lebih merona saat happy/hover.
        const blushTarget = (state === "happy" ? 1 : hovering ? 0.85 : 0.5);
        for (const b of [leftBlush, rightBlush]) {
            b.material.opacity += (blushTarget - b.material.opacity) * Math.min(1, dt * 5);
        }

        // Mulut mengejar target (halus).
        mouthCurrent += (mouthTarget - mouthCurrent) * Math.min(1, dt * 18);
        mouth.scale.x = 0.5 + mouthCurrent * 2.4;
        mouth.scale.y = 1 + mouthCurrent * 0.9;

        // Antena & dada berdenyut.
        const pulse = (state === "listening" || state === "thinking")
            ? 1 + Math.sin(t * 6) * 0.28 : 1 + Math.sin(t * 2.2) * 0.08;
        bulb.scale.setScalar(pulse);
        bulbMat.emissiveIntensity = 2.6 * pulse;
        chestMat.emissiveIntensity = 1.2 + Math.sin(t * 2.4) * 0.5;

        // Cincin aura.
        const auraOn = state === "listening" || state === "speaking";
        ringMat.opacity += ((auraOn ? 0.6 : 0) - ringMat.opacity) * Math.min(1, dt * 6);
        ring.rotation.z = t * 0.6;
        ring.scale.setScalar(1 + (auraOn ? Math.sin(t * 3) * 0.05 : 0));

        // Redup saat offline.
        for (const ball of eyeBalls) {
            const tgt = state === "offline" ? 0.2 : (state === "listening" ? 3.4 : 2.6);
            ball.material.emissiveIntensity += (tgt - ball.material.emissiveIntensity) * 0.1;
        }
        shellMat.emissiveIntensity += ((state === "offline" ? 0 : 0.05) - shellMat.emissiveIntensity) * 0.1;

        renderer.render(scene, camera);
        rafId = requestAnimationFrame(frame);
    }

    let rafId = requestAnimationFrame(frame);

    // Ukuran mengikuti kontainer.
    const resize = () => {
        const w = wrap.clientWidth || 300;
        const h = wrap.clientHeight || 300;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    setTimeout(resize, 0);

    setState("idle");

    return {
        el: wrap,
        setState,
        setMouth,
        get state() { return state; },
        destroy() {
            running = false;
            cancelAnimationFrame(rafId);
            observer.disconnect();
            wrap.removeEventListener("pointermove", onPointerMove);
            wrap.removeEventListener("pointerenter", onEnter);
            wrap.removeEventListener("pointerleave", onLeave);
            renderer.dispose();
            renderer.forceContextLoss?.();
        }
    };

}

export { STATES };
