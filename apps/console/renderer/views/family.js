import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, pill, toast } from "../lib/ui.js";

/**
 * Keluarga & Privasi — dua fitur berbasis-izin:
 *  - Cek Paparan Data (Have I Been Pwned): akun sendiri/keluarga berizin.
 *  - Berbagi Lokasi Keluarga (opt-in): daftar anggota + token perangkat.
 *
 * Tak ada pelacakan nomor telepon dan tak ada data pihak ketiga.
 */
export const family = {

    id: "family",
    label: "Keluarga",
    icon: "check",
    title: "Keluarga & Privasi",
    subtitle: "Cek kebocoran data akun sendiri dan berbagi lokasi keluarga (berbasis izin).",

    render(root) {
        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Keluarga & Privasi</h1>
                    <p>Berbasis izin — tak melacak nomor telepon, tak mengambil data orang lain.</p>
                </div>
            </div>

            <div class="stack">

                <div class="panel">
                    <div class="panel-head">
                        <h2>${icon("check")} Cek Paparan Data</h2>
                        <span class="push" id="exp-status">${pill("Memuat…", "idle")}</span>
                    </div>
                    <div class="stack">
                        <div class="field">
                            <label>API key Have I Been Pwned</label>
                            <div class="row" style="gap:8px">
                                <input type="password" id="exp-key" placeholder="hibp-api-key" style="flex:1">
                                <button class="btn sm" id="exp-save">${icon("check")} Simpan</button>
                            </div>
                            <span class="help">Key milikmu (berbayar dari haveibeenpwned.com). Disimpan lokal, ditutup sebagian.</span>
                        </div>
                        <div class="field">
                            <label>Cek email / username (milikmu atau keluarga yang mengizinkan)</label>
                            <div class="row" style="gap:8px">
                                <input type="text" id="exp-acct" placeholder="nama@email.com" style="flex:1">
                                <button class="btn primary sm" id="exp-check">${icon("search")} Cek</button>
                            </div>
                        </div>
                        <div id="exp-result"></div>
                    </div>
                </div>

                <div class="panel">
                    <div class="panel-head">
                        <h2>${icon("home")} Berbagi Lokasi Keluarga</h2>
                        <span class="hint push">opt-in per perangkat</span>
                    </div>
                    <div class="stack">
                        <div class="row" style="gap:8px">
                            <input type="text" id="fam-name" placeholder="Nama anggota (mis. Adik)" style="flex:1">
                            <button class="btn primary sm" id="fam-add">${icon("plus")} Daftarkan</button>
                        </div>
                        <span class="help">Setelah didaftarkan, share-token muncul SEKALI — pasang di perangkat anggota agar ia mengirim lokasinya sendiri.</span>
                        <div id="fam-body"></div>
                    </div>
                </div>

            </div>`;
    },

    async mount(root) {
        await refreshExposure(root);
        await refreshFamily(root);

        root.querySelector("#exp-save").addEventListener("click", async () => {
            const key = root.querySelector("#exp-key").value.trim();
            if (!key) return toast("Isi API key dulu.", "warn");
            try { await api.exposureConfig(key); await refreshExposure(root); toast("API key disimpan", "ok"); }
            catch (e) { toast(e.message, "danger"); }
        });

        root.querySelector("#exp-check").addEventListener("click", () => runCheck(root));
        root.querySelector("#exp-acct").addEventListener("keydown", e => { if (e.key === "Enter") runCheck(root); });

        root.querySelector("#fam-add").addEventListener("click", async () => {
            const name = root.querySelector("#fam-name").value.trim();
            if (!name) return toast("Isi nama anggota.", "warn");
            try {
                const r = await api.familyRegister(name);
                root.querySelector("#fam-name").value = "";
                await refreshFamily(root);
                showToken(root, r);
            }
            catch (e) { toast(e.message, "danger"); }
        });
    }

};

async function refreshExposure(root) {
    try {
        const s = await api.exposureStatus();
        root.querySelector("#exp-status").innerHTML = s.configured
            ? pill(`Terkonfigurasi (${esc(s.apiKey ?? "")})`, "ok")
            : pill("API key belum diatur", "warn");
    }
    catch (e) {
        root.querySelector("#exp-status").innerHTML = pill("Gagal memuat", "danger");
    }
}

async function runCheck(root) {
    const account = root.querySelector("#exp-acct").value.trim();
    const out = root.querySelector("#exp-result");
    if (!account) return toast("Isi email/username.", "warn");
    out.innerHTML = `<div class="row"><span class="spinner"></span><span class="small muted">Mengecek…</span></div>`;
    try {
        const r = await api.exposureCheck(account);
        out.innerHTML = `
            <div class="divider"></div>
            <div class="row" style="gap:8px;align-items:center">
                ${r.breached ? pill(`${r.count} kebocoran`, "danger") : pill("Aman", "ok")}
                <span class="small muted">${esc(r.account)}</span>
            </div>
            ${r.breaches.length ? `<div class="scroll-x"><table class="table">
                <thead><tr><th>Kebocoran</th><th>Tanggal</th><th>Data</th></tr></thead>
                <tbody>${r.breaches.map(b => `<tr>
                    <td>${esc(b.title || b.name)}</td>
                    <td class="mono small">${esc(b.breachDate ?? "—")}</td>
                    <td class="small">${esc((b.dataClasses || []).join(", "))}</td>
                </tr>`).join("")}</tbody></table></div>` : ""}
            <ul class="small" style="margin-top:8px">${r.advice.map(a => `<li>${esc(a)}</li>`).join("")}</ul>`;
    }
    catch (e) { out.innerHTML = `<div class="small danger-text">${esc(e.message)}</div>`; }
}

async function refreshFamily(root) {
    const body = root.querySelector("#fam-body");
    try {
        const { members } = await api.familyLocations();
        body.innerHTML = members.length === 0
            ? `<div class="empty">${icon("home")}<div>Belum ada anggota berbagi lokasi.</div></div>`
            : `<div class="scroll-x"><table class="table">
                <thead><tr><th>Nama</th><th>Status</th><th>Lokasi terakhir</th><th>Diperbarui</th><th style="width:1%"></th></tr></thead>
                <tbody>${members.map(m => `<tr>
                    <td>${esc(m.name)}</td>
                    <td>${m.sharing ? pill("Berbagi", "ok") : pill("Menunggu perangkat", "idle")}</td>
                    <td class="mono small">${m.location ? `${m.location.lat.toFixed(5)}, ${m.location.lng.toFixed(5)}` : "—"}</td>
                    <td class="small muted">${esc(m.updatedAt ?? "—")}</td>
                    <td><button class="btn sm danger" data-revoke="${esc(m.id)}">${icon("trash")}</button></td>
                </tr>`).join("")}</tbody></table></div>`;
        body.querySelectorAll("[data-revoke]").forEach(btn => {
            btn.addEventListener("click", async () => {
                try { await api.familyRevoke(btn.dataset.revoke); await refreshFamily(root); toast("Berbagi dicabut", "ok"); }
                catch (e) { toast(e.message, "danger"); }
            });
        });
    }
    catch (e) { body.innerHTML = `<div class="small danger-text">${esc(e.message)}</div>`; }
}

function showToken(root, r) {
    const out = root.querySelector("#fam-body");
    const note = document.createElement("div");
    note.className = "panel";
    note.style.marginBottom = "12px";
    note.innerHTML = `
        <div class="small">Anggota <b>${esc(r.name)}</b> didaftarkan. Pasang share-token ini di perangkatnya (muncul sekali):</div>
        <div class="row" style="gap:8px;margin-top:6px">
            <input type="text" class="mono" readonly value="${esc(r.shareToken)}" style="flex:1" id="tok-${esc(r.id)}">
            <button class="btn sm" id="tok-copy-${esc(r.id)}">${icon("copy")} Salin</button>
        </div>`;
    out.prepend(note);
    root.querySelector(`#tok-copy-${r.id}`)?.addEventListener("click", () => {
        navigator.clipboard.writeText(r.shareToken).then(() => toast("Token disalin", "ok"));
    });
}
