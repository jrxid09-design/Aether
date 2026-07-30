import { store } from "../lib/store.js";
import { icon } from "../lib/icons.js";
import { esc, toast } from "../lib/ui.js";

export const settings = {

    id: "settings",
    label: "Settings",
    icon: "settings",
    title: "Settings",
    subtitle: "Koneksi ke daemon dan kendali proses lokal.",

    render(root) {

        const s = store.get().settings;

        const local = store.get().localDaemon;

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Settings</h1>
                    <p>Koneksi ke daemon dan kendali proses lokal.</p>
                </div>
            </div>

            <div class="grid cols-2">

                <div class="panel">
                    <div class="panel-head"><h2>${icon("plug")} Koneksi daemon</h2></div>

                    <div class="stack">

                        <div class="field">
                            <label>Alamat daemon</label>
                            <input type="url" id="set-url" value="${esc(s.daemonUrl)}"
                                placeholder="http://192.168.1.10:3000">
                            <span class="help">
                                Pakai <span class="mono">localhost</span> bila daemon jalan di perangkat ini,
                                atau IP LAN PC rumah bila memantau dari laptop.
                            </span>
                        </div>

                        <div class="field">
                            <label>Token akses</label>
                            <input type="password" id="set-token" value="${esc(s.token)}"
                                placeholder="kosongkan bila AETHER_TOKEN tidak diset">
                            <span class="help">
                                Harus sama dengan <span class="mono">AETHER_TOKEN</span> di
                                <span class="mono">.env</span> daemon. Tanpa token, siapa pun
                                di jaringan yang sama bisa mengakses API.
                            </span>
                        </div>

                        <div class="field">
                            <label>Interval polling</label>
                            <select id="set-poll">
                                ${[2000, 5000, 10000, 30000].map(ms => `
                                    <option value="${ms}" ${ms === s.pollInterval ? "selected" : ""}>
                                        ${ms / 1000} detik
                                    </option>`).join("")}
                            </select>
                        </div>

                        <label class="switch">
                            <input type="checkbox" id="set-auto" ${s.autoConnect ? "checked" : ""}>
                            <span class="track"></span>
                            <span>Sambung otomatis saat Console dibuka</span>
                        </label>

                        <div class="row">
                            <button class="btn primary" id="set-save">${icon("check")} Simpan &amp; sambungkan</button>
                        </div>

                    </div>
                </div>

                <div class="stack">

                    <div class="panel">
                        <div class="panel-head">
                            <h2>${icon("server")} Daemon lokal</h2>
                            <span class="hint push" id="local-state">
                                ${local.running ? `berjalan (pid ${local.pid})` : "berhenti"}
                            </span>
                        </div>

                        <div class="small muted" style="margin-bottom:10px">
                            Menjalankan <span class="mono">src/server.js</span> dari repo ini sebagai
                            proses anak. Berguna saat mengembangkan di laptop; di PC rumah
                            sebaiknya daemon dijalankan sebagai service tersendiri.
                        </div>

                        <div class="row">
                            <button class="btn" id="local-start">${icon("play")} Jalankan</button>
                            <button class="btn ghost" id="local-stop">${icon("stop")} Hentikan</button>
                        </div>

                        <div class="divider"></div>

                        <div class="small dim mono selectable" id="local-path">—</div>
                    </div>

                    <div class="panel">
                        <div class="panel-head"><h2>${icon("alert")} Catatan keamanan</h2></div>
                        <div class="small muted stack" style="gap:8px">
                            <p style="margin:0">
                                Daemon mendengarkan di <span class="mono">0.0.0.0</span>, jadi begitu
                                dijalankan di PC rumah ia terjangkau seluruh perangkat pada LAN yang sama.
                            </p>
                            <p style="margin:0">
                                Set <span class="mono selectable">AETHER_TOKEN</span> di berkas
                                <span class="mono">.env</span> PC tersebut, lalu isikan token yang sama
                                di kolom di samping. Tanpa itu, endpoint chat, eksekusi tool, dan
                                filesystem terbuka tanpa autentikasi.
                            </p>
                        </div>
                    </div>

                </div>

            </div>`;

    },

    async mount(root) {

        const status = await window.aether.daemon.status();

        root.querySelector("#local-path").textContent = status.entry;

        const updateLocal = (running, pid) => {

            store.patch("localDaemon", { running, pid: pid ?? null });

            root.querySelector("#local-state").textContent =
                running ? `berjalan (pid ${pid})` : "berhenti";

        };

        updateLocal(status.running, status.pid);

        root.querySelector("#set-save").addEventListener("click", async () => {

            const patch = {
                daemonUrl: root.querySelector("#set-url").value.trim(),
                token: root.querySelector("#set-token").value,
                pollInterval: Number(root.querySelector("#set-poll").value),
                autoConnect: root.querySelector("#set-auto").checked
            };

            const saved = await window.aether.settings.set(patch);

            store.set({ settings: saved });

            toast("Pengaturan disimpan", "ok");

            document.dispatchEvent(new CustomEvent("aether:reconnect"));

        });

        root.querySelector("#local-start").addEventListener("click", async () => {

            const result = await window.aether.daemon.start();

            if (result.error) {
                toast(result.error, "danger");
                return;
            }

            // Daemon lain sudah hidup di alamat ini — Console tidak
            // menjalankan proses kedua, cukup menyambung.
            if (result.external) {

                updateLocal(false, null);

                toast("Daemon sudah berjalan di alamat ini — menyambungkan…", "ok");

                document.dispatchEvent(new CustomEvent("aether:reconnect"));

                return;

            }

            updateLocal(true, result.pid);

            toast(
                result.alreadyRunning
                    ? "Daemon lokal sudah berjalan"
                    : `Daemon lokal dijalankan (pid ${result.pid})`,
                "ok"
            );

            // Beri jeda agar server sempat listen sebelum disambung.
            setTimeout(
                () => document.dispatchEvent(new CustomEvent("aether:reconnect")),
                1800
            );

        });

        root.querySelector("#local-stop").addEventListener("click", async () => {

            await window.aether.daemon.stop();

            updateLocal(false, null);

            toast("Daemon lokal dihentikan", "warn");

        });

    }

};
