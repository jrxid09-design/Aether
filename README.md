# Aether

**AI Runtime Framework** + entitas AI pribadi untuk rumah — berjalan lokal di
perangkatmu sendiri. Aether menyatukan otak AI (lokal maupun cloud), memori
jangka panjang, penglihatan (kamera/CCTV), kendali rumah, WhatsApp, dan
orkestrasi multi-agent (OpenClaw & Hermes) di balik satu daemon, dengan
**Console desktop**, **CLI**, dan **skill** yang bisa dipanggil lewat obrolan.

> Semua data (memori, kredensial, sesi) tersimpan **lokal** dan gitignored.

---

## Daftar isi
- [Fitur](#fitur)
- [Arsitektur singkat](#arsitektur-singkat)
- [Prasyarat](#prasyarat)
- [Instalasi](#instalasi)
- [Menjalankan](#menjalankan)
- [Konfigurasi (Console → Settings)](#konfigurasi-console--settings)
- [Skills](#skills)
- [Memori](#memori)
- [Log & investigasi](#log--investigasi)
- [Struktur proyek](#struktur-proyek)
- [Keamanan](#keamanan)
- [Troubleshooting](#troubleshooting)

---

## Fitur

- **Otak fleksibel** — pilih **AI Lokal** (Ollama) atau **AI Provider** (OpenRouter,
  OpenAI, Google AI Studio, Groq, atau custom OpenAI-compatible). Daftar model
  **dikurasi otomatis**: model gratis diutamakan, model non-chat/usang disaring,
  ada **verifikasi** + **fallback otomatis** bila model 404/deprecated.
- **Memori jangka panjang** — SQLite + FTS5 + embedding (recall hibrida). Aether
  mengingat identitas, kebiasaan, perangkat, dan dokumen.
- **Skills (50+)** — kemampuan siap pakai yang menggabungkan semua subsistem +
  delegasi ke **OpenClaw** (otomasi desktop) & **Hermes** (agent runtime) +
  **orkestrasi** multi-agent. Aether juga bisa **membuat skill sendiri** lewat
  percakapan (draft → aktifkan).
- **WhatsApp** — chat pribadi & grup, balas saat di-mention/di-reply, analisis
  media masuk (gambar/stiker/voice note/dokumen), kirim media. Login via **QR**.
- **Vision** — "melihat" kamera/CCTV & webcam, pratinjau live, terintegrasi ke chat.
- **Home automation** — kendali Home Assistant (lampu, AC, saklar, scene).
- **Orang & wajah** — galeri Immich + pengenalan wajah (opsional).
- **Suara** — TTS (suara OS atau neural mis. Kokoro) + STT (mis. faster-whisper) +
  avatar minibot.
- **Proaktif** — brief keadaan rumah harian terjadwal, dikirim ke WhatsApp.
- **Antarmuka** — Console desktop (Electron), CLI terminal, dan REST/SSE API.

---

## Arsitektur singkat

```
   Console (Electron) · CLI (npm run cli) · WhatsApp · REST/SSE API
                          │  (klien tipis)
                 ┌────────▼─────────────────────────────────────────┐
                 │  Daemon (Express)  ·  src/server.js  ·  :3000       │
                 ├────────────────────────────────────────────────────┤
                 │ AI Runtime  — provider abstraction, tools, fallback │
                 │ Memory      — SQLite/FTS5/vektor                    │
                 │ Skills/Plugins · Vision · Home · Immich · WhatsApp  │
                 │ Automation  — brief proaktif                        │
                 │ AgentHub → Ollama / OpenClaw / Hermes · Orchestrator│
                 └────────────────────────────────────────────────────┘
```

- **Core kecil & stabil**; kemampuan baru masuk sebagai **plugin/skill**,
  **provider**, atau **service** — bukan mengubah core.
- Semua klien (Console/CLI/WhatsApp) adalah klien tipis ke daemon.

---

## Prasyarat

- **Node.js ≥ 18** dan **npm**.
- Wajib: tidak ada. Aether tetap hidup tanpa API key (pakai Ollama bila ada,
  atau menunggu dikonfigurasi).
- Opsional (aktifkan sesuai kebutuhan):
  - **Ollama** — AI lokal & embedding memori.
  - **API key** OpenRouter / OpenAI / Google AI Studio / Groq — AI cloud.
  - **WhatsApp** — paket `@whiskeysockets/baileys` + `qrcode`.
  - **Home Assistant** — kendali rumah (URL + long-lived token).
  - **Immich** / layanan wajah — foto & pengenalan wajah.
  - **Kokoro-FastAPI** (TTS neural) & **faster-whisper** (STT).
  - **OpenClaw** & **Hermes** — otomasi desktop & agent runtime.

---

## Instalasi

```bash
git clone https://github.com/jrxid09-design/Aether.git
cd Aether

# dependensi daemon
npm install

# dependensi Console desktop (Electron)
npm run console:install

# (opsional) WhatsApp
npm install @whiskeysockets/baileys qrcode
```

---

## Menjalankan

**Satu perintah (disarankan)** — daemon + Console sekaligus, dengan banner
berwarna dan **log rinci berstempel waktu** di terminal (juga disimpan ke
`logs/aether-YYYY-MM-DD.log`):

```bash
npm run aether
```

Perintah lain:

| Perintah | Fungsi |
|---|---|
| `npm run aether` | Daemon **+** Console desktop (satu operasi, log rinci) |
| `npm run aether:daemon` | Daemon saja, tampilan launcher + log rinci |
| `npm start` | Daemon saja (banner ringkas) |
| `npm run dev` | Daemon dengan auto-reload (nodemon) |
| `npm run console` | Console desktop saja (butuh daemon jalan) |
| `npm run cli` | CLI terminal interaktif |

Variabel lingkungan:

| Env | Arti |
|---|---|
| `PORT` | Port daemon (default `3000`) |
| `AETHER_TOKEN` | Kunci API bidang kendali (kosong = terbuka di jaringan lokal) |
| `AETHER_PORT_AUTO=1` | Geser port otomatis bila bentrok |

Hentikan semuanya dengan **Ctrl+C**.

---

## Konfigurasi (Console → Settings)

Semua diatur dari **Console → Settings** dan disimpan lokal (gitignored).

### Provider AI
- **AI Lokal** — Ollama (base URL + model). Gratis & privat.
- **AI Provider** — pilih platform, tempel **API key**, tekan **Muat** untuk
  daftar model (bertanda `free`), atau **Verifikasi** untuk menguji tiap model
  (✓ = benar-benar bisa dipakai). Model usang/non-chat disembunyikan; bila model
  aktif mati, Aether **pindah otomatis** ke model kerja berikutnya.

### WhatsApp (QR)
1. `npm install @whiskeysockets/baileys qrcode` lalu mulai ulang daemon.
2. Settings → WhatsApp → **Hubungkan / tampilkan QR**.
3. Di HP: **WhatsApp → Perangkat Tertaut → Tautkan Perangkat → pindai QR**.
4. Isi **nomor pribadi yang diizinkan** (kirim `/id` ke Aether untuk tahu nomormu)
   dan **id grup** bila ingin aktif di grup (sebut "Aether"/reply).
   Ganti nomor perangkat: **Putuskan** lalu pindai ulang.

### Lainnya
- **Suara** — endpoint STT (transcribe) & TTS neural (mis. Kokoro); kosong = suara OS.
- **Home Assistant** — URL + long-lived token.
- **Vision** — pilih model dari integrasi AI aktif; tambah kamera (URL snapshot),
  pratinjau live.
- **Orang & Wajah** — Immich (URL + key) + layanan wajah (opsional).
- **Proaktif** — aktifkan brief harian + jam kirim (dikirim ke WhatsApp).

---

## Skills

Aether punya **50+ skill** bawaan (`src/plugins/aetherSkills`) + skill buatan
sendiri. Skill otomatis menjadi tool yang bisa dipanggil AI.

**Cara pakai:**
1. **Ngobrol** (Chat Console / WhatsApp / CLI) — tulis maksudmu, Aether memilih
   skill sendiri. Contoh: *"lihat kamera dapur"*, *"kirim WA ke 62812…: …"*,
   *"nyalakan lampu ruang tamu"*, *"riset X lalu kirim ke WA-ku"*,
   *"briefing pagi"*, *"buka Notepad ketik …"* (OpenClaw), tugas kompleks →
   *"orkestrasikan: …"*.
2. **Manual** — Console → **Skills & Studio → Terpasang** → pilih tool → isi
   parameter → Jalankan.
3. **Buat skill baru** — minta Aether: *"buatkan skill untuk …"*. Ia membuat
   **draft**, lalu bertanya apakah diaktifkan (tolak = tersimpan sebagai draft).

Kategori: delegasi OpenClaw/Hermes & orkestrasi, WhatsApp, vision/CCTV, home
automation, memori, Immich, konteks, serta alur komposit (mis. `morning_briefing`,
`arrive_home`, `leave_home`, `security_alert`, `research_and_send`).

> Skill OpenClaw/Hermes butuh kedua agent online; Home/Immich/Vision butuh
> terkonfigurasi. Bila belum siap, skill membalas pesan error yang jelas.

---

## Memori

- Aether menyimpan fakta penting secara otomatis dan bisa diminta *"ingat …"*
  atau *"apa yang kamu ingat soal …"*.
- Console → **Memory**: jelajah/cari memori, kelola entitas, dan **baca dokumen**
  dengan **memilih berkas/folder langsung** (dialog native, tanpa ketik path).

---

## Log & investigasi

- `npm run aether` menstream log **daemon** (dan **console**) ke terminal dengan
  stempel waktu + tag sumber + warna per level, dan menyimpannya ke
  `logs/aether-YYYY-MM-DD.log`.
- Console → **Logs** menampilkan aliran event/log daemon secara live.

---

## Struktur proyek

```
src/
  server.js            daemon (Express + SSE)
  ai/                  AI runtime (builder, providers, executors, tools)
  services/            aiRuntime, whatsapp, vision, home, immich, agentHub,
                       orchestrator, automation, modelHealth, dst.
  plugins/             plugin bawaan + aetherSkills (50+ skill)
  memory/              skema, store, recall, embedding, dokumen
  cli/                 CLI terminal (tema, perintah, klien)
  controllers/ routes/ bidang kendali REST
scripts/launch.js      launcher satu-perintah (daemon + console + log)
apps/console/          Console desktop (Electron)
configs/               kredensial & setelan lokal (gitignored)
```

---

## Keamanan

- Set **`AETHER_TOKEN`** agar bidang kendali tidak terbuka di jaringan.
- Rahasia (API key, sesi WhatsApp, dll) disimpan di `configs/*` dan **gitignored**.
- Jangan pernah menaruh API key di kode/commit — isi lewat Settings.

---

## Troubleshooting

- **Port 3000 dipakai** → daemon lain masih hidup. Hentikan
  (`Get-Process node | Stop-Process -Force` di Windows) atau `set PORT=3001`.
- **WhatsApp `loggedOut` / "Cannot link device"** → sesi lama invalid. Settings →
  WhatsApp → **Putuskan**, lalu **Hubungkan** & pindai QR lagi.
- **Google AI `404`** → model usang; Aether otomatis pindah ke model kerja.
  Pilih model bertanda ✓/free, atau tekan **Verifikasi**.
- **`429` kuota** → kuota harian provider habis; ganti model/provider atau pakai
  **AI Lokal (Ollama)**.
- **OpenClaw/Hermes skill gagal** → pastikan kedua agent berjalan & terkonfigurasi
  di `configs/integrations.json`.
