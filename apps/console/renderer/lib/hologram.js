import * as THREE from "../vendor/three.module.js";

/**
 * Hologram JARVIS Aether — inti energi holografik (cyberpunk).
 *
 * Bukan robot; sebuah "AI core": ikosahedron wireframe berdenyut,
 * cincin orbit ganda, dan halo partikel. Bereaksi terhadap STATE
 * (idle/listening/thinking/speaking/error/offline) dan AMPLITUDO
 * suara (setLevel 0..1) → berkembang & berpijar saat merespon.
 *
 * Interface sama dengan avatar3d (el, setState, setMouth≈setLevel,
 * destroy) sehingga bisa dipasang di mana pun Aether menaruh avatar.
 * Melempar bila WebGL tak ada → pemanggil boleh fallback.
 */

const STATES = ["idle", "listening", "thinking", "speaking", "happy", "error", "offline"];

const COL = {
    idle:      new THREE.Color(0x14e6ff),
    listening: new THREE.Color(0x5cf0ff),
    thinking:  new THREE.Color(0x7c5cff),
    speaking:  new THREE.Color(0x14e6ff),
    happy:     new THREE.Color(0x8dffcf),
    error:     new THREE.Color(0xff3b6b),
    offline:   new THREE.Color(0x3a4668)
};

export function createHologram() {

    const wrap = document.createElement("div");
    wrap.style.width = "100%";
    wrap.style.height = "100%";

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(320, 320);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 6);

    const core = new THREE.Group();
    scene.add(core);

    // ---- Inti: ikosahedron wireframe + selubung isi transparan ----
    const icoGeo = new THREE.IcosahedronGeometry(1.35, 1);
    const wireMat = new THREE.MeshBasicMaterial({ color: COL.idle, wireframe: true, transparent: true, opacity: 0.9 });
    const wire = new THREE.Mesh(icoGeo, wireMat);
    core.add(wire);

    const shellMat = new THREE.MeshBasicMaterial({ color: COL.idle, transparent: true, opacity: 0.06 });
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.28, 2), shellMat);
    core.add(shell);

    // Inti kecil bercahaya (jantung).
    const heartMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), heartMat);
    core.add(heart);

    // ---- Cincin orbit ---------------------------------------------
    function makeRing(r, tube, color, rx, ry) {
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 90), m);
        ring.rotation.x = rx; ring.rotation.y = ry;
        core.add(ring);
        return ring;
    }
    const ringA = makeRing(2.0, 0.012, COL.idle, Math.PI / 2.2, 0);
    const ringB = makeRing(2.35, 0.01, new THREE.Color(0xff3bd4), Math.PI / 3, Math.PI / 5);
    const ringC = makeRing(1.72, 0.014, new THREE.Color(0x7c5cff), Math.PI / 1.7, -Math.PI / 6);

    // ---- Halo partikel --------------------------------------------
    const COUNT = 420;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
        const r = 2.1 + Math.random() * 1.4;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
        pos[i * 3 + 2] = r * Math.cos(ph);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({ color: COL.idle, size: 0.03, transparent: true, opacity: 0.7, sizeAttenuation: true });
    const particles = new THREE.Points(pGeo, pMat);
    core.add(particles);

    // ---- State & animasi ------------------------------------------
    let state = "idle";
    let level = 0, levelSmooth = 0;
    let running = true;
    const target = COL.idle.clone();
    const cur = COL.idle.clone();
    const clock = new THREE.Clock();

    function setState(next) {
        if (!STATES.includes(next)) return;
        state = next;
        target.copy(COL[next] ?? COL.idle);
    }
    function setLevel(v) { level = Math.max(0, Math.min(1, v || 0)); }

    function applyColor(c) {
        wireMat.color.copy(c); shellMat.color.copy(c); ringA.material.color.copy(c);
        pMat.color.copy(c);
    }

    function frame() {
        if (!running) return;
        const t = clock.getElapsedTime();
        const dt = Math.min(0.05, clock.getDelta());

        cur.lerp(target, Math.min(1, dt * 4));
        applyColor(cur);

        levelSmooth += (level - levelSmooth) * Math.min(1, dt * 12);

        const busy = state === "listening" || state === "thinking" || state === "speaking";
        const spin = state === "thinking" ? 1.8 : state === "offline" ? 0.05 : 0.5;

        core.rotation.y += dt * spin * 0.5;
        wire.rotation.x += dt * 0.25;
        wire.rotation.y -= dt * 0.3;

        // Denyut + reaksi amplitudo suara.
        const pulse = 1 + Math.sin(t * (busy ? 5 : 2)) * (busy ? 0.05 : 0.02) + levelSmooth * 0.28;
        wire.scale.setScalar(pulse);
        shell.scale.setScalar(1 + levelSmooth * 0.35);
        heart.scale.setScalar(0.7 + Math.sin(t * 3) * 0.06 + levelSmooth * 0.9);
        heartMat.opacity = 0.6 + levelSmooth * 0.4;

        ringA.rotation.z += dt * 0.6;
        ringB.rotation.z -= dt * 0.4;
        ringC.rotation.z += dt * 0.8;
        const ringGlow = 0.5 + (busy ? 0.4 : 0) + levelSmooth * 0.5;
        ringA.material.opacity = ringGlow; ringB.material.opacity = ringGlow * 0.9; ringC.material.opacity = ringGlow;

        particles.rotation.y -= dt * 0.15;
        particles.rotation.x += dt * 0.05;
        pMat.opacity = (state === "offline" ? 0.15 : 0.6) + levelSmooth * 0.4;
        pMat.size = 0.028 + levelSmooth * 0.03;

        // Redup total saat offline.
        const dim = state === "offline" ? 0.25 : 1;
        wireMat.opacity += ((0.9 * dim) - wireMat.opacity) * 0.1;

        renderer.render(scene, camera);
        rafId = requestAnimationFrame(frame);
    }
    let rafId = requestAnimationFrame(frame);

    const resize = () => {
        const w = wrap.clientWidth || 320, h = wrap.clientHeight || 320;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    setTimeout(resize, 0);

    return {
        el: wrap,
        setState,
        setLevel,
        setMouth: setLevel,               // alias kompat avatar
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
