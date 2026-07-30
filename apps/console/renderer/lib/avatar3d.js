import * as THREE from "../vendor/three.module.js";

/**
 * Minibot 3D Aether.
 *
 * Karakter robot kecil yang lucu dibangun prosedural dengan
 * Three.js — kepala membulat, mata bercahaya, antena, telinga.
 * Antarmukanya SAMA dengan avatar SVG (createAvatar) — el,
 * setState, setMouth, destroy — jadi layar Aether bisa menukar
 * keduanya tanpa perubahan lain. Bila WebGL tak tersedia,
 * pembuatannya melempar error dan pemanggil jatuh ke versi SVG.
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
    ok: 0x34d399
};

export function createAvatar3D() {

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";

    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(300, 300);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 6.2);

    // ---- Pencahayaan (nuansa aurora) ---------------------------
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const keyLight = new THREE.PointLight(C.cyan, 40, 30);
    keyLight.position.set(-4, 3, 5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(C.purple, 35, 30);
    rimLight.position.set(4, -2, 4);
    scene.add(rimLight);

    const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
    topLight.position.set(0, 5, 2);
    scene.add(topLight);

    // ---- Badan robot -------------------------------------------
    const bot = new THREE.Group();
    scene.add(bot);

    const headMat = new THREE.MeshStandardMaterial({
        color: C.blue,
        roughness: 0.35,
        metalness: 0.55,
        emissive: C.blue,
        emissiveIntensity: 0.08
    });

    // Kepala: kubus membulat (via sphere yang di-skala boxy).
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(1.35, 48, 48),
        headMat
    );
    head.scale.set(1.15, 1, 0.95);
    bot.add(head);

    // Layar wajah gelap di depan.
    const faceMat = new THREE.MeshStandardMaterial({
        color: 0x05060c,
        roughness: 0.5,
        metalness: 0.3
    });
    const face = new THREE.Mesh(new THREE.SphereGeometry(1.02, 40, 40), faceMat);
    face.scale.set(1.02, 0.86, 0.6);
    face.position.set(0, 0.02, 0.72);
    bot.add(face);

    // Mata (emissive).
    const eyeMat = new THREE.MeshStandardMaterial({
        color: C.cyan,
        emissive: C.cyan,
        emissiveIntensity: 2.4,
        roughness: 0.3
    });

    const eyeGeo = new THREE.CapsuleGeometry(0.16, 0.18, 6, 16);

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.42, 0.12, 1.16);
    bot.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat.clone());
    rightEye.position.set(0.42, 0.12, 1.16);
    bot.add(rightEye);

    const eyes = new THREE.Group();
    // (mata sudah di bot; grup dipakai untuk referensi warna saja)

    // Mulut (emissive, tinggi berubah saat bicara).
    const mouthMat = new THREE.MeshStandardMaterial({
        color: C.cyan,
        emissive: C.cyan,
        emissiveIntensity: 1.8
    });
    const mouth = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.09, 0.34, 4, 12),
        mouthMat
    );
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0, -0.42, 1.14);
    bot.add(mouth);

    // Antena.
    const antMat = new THREE.MeshStandardMaterial({ color: C.blue, metalness: 0.7, roughness: 0.3 });
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), antMat);
    antenna.position.set(0, 1.45, 0);
    bot.add(antenna);

    const bulbMat = new THREE.MeshStandardMaterial({
        color: C.cyan, emissive: C.cyan, emissiveIntensity: 2.5
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), bulbMat);
    bulb.position.set(0, 1.78, 0);
    bot.add(bulb);

    // Telinga.
    const earMat = new THREE.MeshStandardMaterial({ color: C.purple, metalness: 0.6, roughness: 0.4 });
    const earGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.2, 20);
    const leftEar = new THREE.Mesh(earGeo, earMat);
    leftEar.rotation.z = Math.PI / 2;
    leftEar.position.set(-1.38, 0, 0);
    bot.add(leftEar);
    const rightEar = new THREE.Mesh(earGeo, earMat);
    rightEar.rotation.z = Math.PI / 2;
    rightEar.position.set(1.38, 0, 0);
    bot.add(rightEar);

    // Cincin aura (menyala saat mendengar/bicara).
    const ringMat = new THREE.MeshBasicMaterial({
        color: C.cyan, transparent: true, opacity: 0
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.03, 12, 64), ringMat);
    ring.position.z = -0.2;
    bot.add(ring);

    // ---- State & animasi ---------------------------------------
    let state = "idle";
    let mouthTarget = 0;
    let mouthCurrent = 0;
    let blink = 0;
    let running = true;
    const clock = new THREE.Clock();

    function setEyeColor(hex, intensity = 2.4) {
        for (const eye of [leftEye, rightEye]) {
            eye.material.color.setHex(hex);
            eye.material.emissive.setHex(hex);
            eye.material.emissiveIntensity = intensity;
        }
        mouthMat.color.setHex(hex);
        mouthMat.emissive.setHex(hex);
        bulbMat.color.setHex(hex);
        bulbMat.emissive.setHex(hex);
        ringMat.color.setHex(hex);
    }

    function setState(next) {
        if (!STATES.includes(next)) return;
        state = next;

        if (next === "error") setEyeColor(C.danger, 2.2);
        else if (next === "happy") setEyeColor(C.ok, 2.6);
        else if (next === "listening") setEyeColor(C.cyan, 3.2);
        else setEyeColor(C.cyan, 2.4);

        if (next !== "speaking") {
            mouthTarget = 0;
        }
    }

    function setMouth(amount) {
        mouthTarget = Math.max(0, Math.min(1, amount || 0));
    }

    function frame() {
        if (!running) return;

        const t = clock.getElapsedTime();
        const dt = clock.getDelta();

        // Mengambang & sedikit bergoyang — tanda "hidup".
        if (state !== "offline") {
            bot.position.y = Math.sin(t * 1.6) * 0.08;
            bot.rotation.y = Math.sin(t * 0.6) * 0.18;
            bot.rotation.x = Math.sin(t * 0.9) * 0.05;
        }

        // Kedip berkala.
        blink += dt;
        let eyeScaleY = 1;
        if (blink > 3.4) {
            const p = (blink - 3.4) / 0.14;
            eyeScaleY = p < 1 ? Math.abs(Math.cos(p * Math.PI)) : 1;
            if (blink > 3.54) blink = 0;
        }

        // Bentuk mata per-state.
        let baseEyeScale = 1;
        if (state === "listening") baseEyeScale = 1.25;
        if (state === "happy") eyeScaleY *= 0.55;
        leftEye.scale.y = rightEye.scale.y = baseEyeScale * eyeScaleY;
        leftEye.scale.x = rightEye.scale.x = state === "listening" ? 1.15 : 1;

        // Melirik ke atas saat berpikir.
        const lookUp = state === "thinking" ? 0.16 : 0.12;
        leftEye.position.y = rightEye.position.y = lookUp;
        if (state === "thinking") bot.rotation.z = Math.sin(t * 2) * 0.06;
        else bot.rotation.z = 0;

        // Mulut mengejar target (halus).
        mouthCurrent += (mouthTarget - mouthCurrent) * Math.min(1, dt * 18);
        mouth.scale.x = 0.5 + mouthCurrent * 2.4;   // capsule sepanjang sumbu (rotasi z)
        mouth.scale.y = 1 + mouthCurrent * 0.6;

        // Antena berdenyut saat mendengar/berpikir.
        const pulse = (state === "listening" || state === "thinking")
            ? 1 + Math.sin(t * 6) * 0.25 : 1;
        bulb.scale.setScalar(pulse);
        bulbMat.emissiveIntensity = 2.5 * pulse;

        // Cincin aura.
        const auraOn = state === "listening" || state === "speaking";
        ringMat.opacity += ((auraOn ? 0.6 : 0) - ringMat.opacity) * Math.min(1, dt * 6);
        ring.rotation.z = t * 0.6;
        ring.scale.setScalar(1 + (auraOn ? Math.sin(t * 3) * 0.05 : 0));

        // Redup saat offline.
        const target = state === "offline" ? 0.25 : 1;
        headMat.emissiveIntensity += ((state === "offline" ? 0 : 0.08) - headMat.emissiveIntensity) * 0.1;
        for (const eye of [leftEye, rightEye]) {
            eye.material.emissiveIntensity += ((state === "offline" ? 0.2 : 2.4) - eye.material.emissiveIntensity) * 0.1;
        }

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
    // Panggil sekali setelah masuk DOM.
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
            renderer.dispose();
            renderer.forceContextLoss?.();
        }
    };

}

export { STATES };
