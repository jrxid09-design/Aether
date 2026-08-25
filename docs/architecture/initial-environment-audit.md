# Aether OS — Initial Environment Audit

**Tanggal:** 2026-08-11
**Fase:** Phase 0 — Environment & Architecture Audit
**Mesin:** `AETHER` (workstation utama, bukan lagi laptop prototipe)
**Sifat audit:** read-only. Tidak ada instalasi, penghapusan, atau perubahan konfigurasi selama audit.

---

## 1. Ringkasan Eksekutif

Lingkungan ini **layak** menjadi host Aether OS, tetapi **empat temuan mengubah asumsi arsitektur** yang tertulis di direktif. Semuanya ditangani lewat ADR, bukan diabaikan.

| # | Temuan | Dampak |
|---|--------|--------|
| 1 | **Tidak ada GPU diskrit** — hanya Intel UHD 770 (VRAM 2 GB bersama) | Semua inferensi lokal CPU-bound. Tidak ada CUDA. Mengubah strategi Model Router, Vision, dan STT/TTS secara mendasar. |
| 2 | **Drive sistem C: tinggal 86 GB** dari 237 GB | Neo4j + Qdrant + MinIO + PostgreSQL + toolchain Rust + model tidak muat nyaman. Data infrastruktur wajib ke D:/E:. |
| 3 | **Aether lama sedang berjalan di produksi** dengan autostart | Membangun di tempat yang sama akan merusak Immich, foto, dan daemon yang dipakai sehari-hari. |
| 4 | **43.000 baris kode legacy dengan 1 berkas tes** | Migrasi borongan mustahil memenuhi Definition of Done (§221). Legacy = referensi, bukan fondasi. |

---

## 2. Hardware

| Komponen | Nilai |
|---|---|
| CPU | Intel Core i5-14500 — 14 core / 20 thread @ 2.6 GHz |
| RAM | 31,7 GB (17,5 GB bebas saat audit) |
| GPU | **Intel UHD Graphics 770** — VRAM 2.048 MB (bersama), driver 32.0.101.7088 |
| GPU diskrit | **TIDAK ADA** |

### Disk

| Drive | Bebas | Total | Label | Media |
|---|---|---|---|---|
| C: | 86,2 GB | 237,4 GB | — | **NVMe SSD** |
| D: | 815,8 GB | 931,5 GB | Data | HDD SATA (ST1000VX005) |
| E: | 619,9 GB | 638,5 GB | yansiska | HDD SATA (ST1000LX015), **dynamic disk** |

**Catatan E:** disk dinamis dengan 292,3 GB tidak teralokasi yang tidak bisa digabung dengan tool bawaan Windows (celah terhalang partisi Recovery, di luar wilayah LDM). Kapasitas efektif tetap 638,5 GB.

---

## 3. Sistem Operasi

| | |
|---|---|
| OS | Microsoft Windows 11 Pro |
| Build | 26200 |
| Arsitektur | 64-bit |

---

## 4. Runtime Pengembangan

### Tersedia

| Runtime | Versi | Catatan |
|---|---|---|
| Node.js | v24.19.0 | Runtime legacy Aether |
| npm | 11.17.0 | |
| Git | 2.55.0.windows.3 | |
| Docker Engine | 29.6.2 | Backend WSL2 |
| Docker Compose | v5.3.1 | |
| Python | 3.11.15 | Dikelola `uv` |
| Python (launcher) | 3.13.14 | via `py` |
| uv | 0.12.3 | Package manager Python |
| WSL | 2 — Ubuntu (stopped), docker-desktop (running) | |

### Belum ada — dibutuhkan stack target

| Komponen | Keperluan | Status |
|---|---|---|
| **Rust / Cargo** | Wajib untuk Tauri (§8) | **TIDAK ADA** |
| **Neo4j** | Graph memory (§8) | **TIDAK ADA** (port 7687/7474 bebas) |
| **Qdrant** | Vector memory (§8) | **TIDAK ADA** (port 6333 bebas) |
| **MinIO** | Object/artifact storage (§8) | **TIDAK ADA** (port 9000 bebas) |
| **PostgreSQL** (standalone) | Structured state (§8) | **TIDAK ADA** (port 5432 bebas) |

> PostgreSQL memang berjalan, tetapi **di dalam container Immich** dan merupakan milik Immich. Aether OS **tidak boleh** menumpang database aplikasi lain — melanggar batas kepemilikan data dan provenance (§10, §20).

---

## 5. Model AI Lokal

| Model | Ukuran | Kemampuan |
|---|---|---|
| `llama3.1:latest` (8B) | 4,9 GB | chat, tools |
| `qwen2.5-coder:14b` | 9,0 GB | coding |
| `qwen2.5vl:7b` | 6,0 GB | vision |
| `qwen2.5vl:3b` | 3,2 GB | vision (ringan) |
| `nomic-embed-text` | 274 MB | embedding |

Model lokal kini berupa berkas GGUF di folder `models/` proyek (NVMe).

### Performa terukur (CPU-only)

| Metrik | Nilai |
|---|---|
| Cold load `llama3.1:8b` dari NVMe | **10,2 detik** |
| Warm inference (prompt pendek) | **2,7 detik** |
| Prompt eval | **± 43 token/detik** |
| Prompt 11.900 token (75 tool) | **± 94 detik** — tidak dapat dipakai |
| Prompt 3.900 token (16 tool) | dapat dipakai sebagai fallback |

Ini bukan angka teoretis; semuanya diukur langsung pada mesin ini.

---

## 6. Jaringan

| | |
|---|---|
| LAN | 192.168.1.8 (DHCP, gateway 192.168.1.1) |
| Tailscale | 100.97.75.21 (host `aether`) |
| Internet | Tersedia (HTTP 200) |

**Dua kendala jaringan yang sudah terverifikasi:**

1. **Router mengisolasi klien.** Sapuan ping 192.168.1.1–60 hanya menjawab dari router dan mesin ini sendiri; tabel ARP hanya berisi 1 entri. Perangkat lain **tidak bisa** menjangkau layanan di mesin ini lewat LAN. Akses lintas-perangkat saat ini bergantung pada **Tailscale**.
2. **IP LAN berasal dari DHCP**, bukan statis — alamat bisa berubah saat router restart.

---

## 7. Infrastruktur yang Sedang Berjalan

### Container aktif

| Container | Status |
|---|---|
| `immich_server` | Up 6 jam (healthy) |
| `immich_machine_learning` | Up 6 jam (healthy) |
| `immich_postgres` | Up 6 jam (healthy) |
| `immich_redis` | Up 6 jam |

Data Immich: library foto di `D:\AetherNAS\immich\library`, database di `E:\AetherNAS\immich\postgres`. Berisi **4.198 aset** (3.231 foto + 967 video) hasil indeks External Library.

### Layanan host

| Layanan | Port | Status | Autostart |
|---|---|---|---|
| Aether daemon (legacy) | 3000 | Berjalan | Scheduled Task "Aether Daemon" |
| Docker Desktop | — | Berjalan | Registry Run + `AutoStart=true` |

### Rusak / hilang

| Layanan | Port | Status |
|---|---|---|
| Kokoro (TTS) | 8880 | **Image hilang** dari image store |
| Piper / openedai-speech (TTS-ID) | 8881 | **Image hilang** |
| faster-whisper (STT) | 8000 | Image ada (1,92 GB), container tidak berjalan |

Dugaan penyebab: migrasi containerd snapshotter (`UseContainerdSnapshotter = true`) membuat image lama tidak terbaca. Total image turun dari 12,9 GB → 7,9 GB tanpa `prune` dijalankan.

---

## 8. Kode Aether Lama (Legacy)

**Lokasi:** `C:\Workspace\Aether` — branch `develop`, commit `f5b3858`

| Metrik | Nilai |
|---|---|
| Berkas JavaScript | 440 |
| Baris kode | **42.970** |
| Berkas tes | **1** |
| Runtime | Node.js CommonJS |
| UI | Electron (`apps/console`) |

### Modul yang ada

```
agent  ai  bootstrap  capability  cli  coding  config  controllers
core  database  errors  events  integrations  memory  middleware
plugins  prompts  providers  repositories  routes  runtime  services
skillEngine  skills  tools_old  utils  ws
```

### Komponen yang layak dijadikan referensi

| Komponen | Nilai bagi Aether OS |
|---|---|
| `src/core/events/` | Kelas event terstruktur (`AIRequestStarted/Completed/Failed`, `ToolExecuted`, `PluginLoaded`) — pola matang, konsepnya dapat diadopsi |
| `src/ai/providers/` | Abstraksi provider (lokal llama.cpp/OpenAI-compatible) dengan factory + mapper — pemisahan yang bersih |
| `src/ai/tools/AIToolRegistry` | Registry tool dengan skema |
| `src/memory/` | Memori SQLite + embedding + strategi recall keyword & vector |
| `src/coding/` | `CodingBrain`, `Planner`, `testRunner`, `bugMemory`, adapter graphify |
| `src/services/aiRuntimeService` | Fallback lintas-provider + cache kesehatan model |

### Utang teknis yang TIDAK boleh diwarisi

| Masalah | Bukti |
|---|---|
| **Nyaris tanpa tes** | 1 berkas tes untuk 43.000 baris |
| **Modul mati** | `tools_old/` masih ada di pohon sumber |
| **Rahasia di dalam repo** | API key tersimpan plaintext di `configs/providers.json` dan `.env` |
| **Tanpa lapisan tipe** | JavaScript polos tanpa TypeScript maupun anotasi |
| **Tanpa observability** | Tidak ada OpenTelemetry, tidak ada metrik terstruktur |
| **Tanpa sandbox** | Eksekusi tool langsung di proses host |
| **Tanpa policy engine** | Tidak ada capability/risk level; tool berjalan tanpa otorisasi berjenjang |
| **Kernel non-deterministik** | Logika bisnis bercampur dengan pemanggilan model |

---

## 9. Risiko & Konflik

| # | Risiko | Tingkat | Mitigasi |
|---|---|---|---|
| R1 | **Tidak ada GPU** — target Vision/STT/TTS/reasoning berat tidak realistis lokal | **Tinggi** | ADR-003: Model Router sadar-latensi, hybrid lokal+cloud, degradasi eksplisit |
| R2 | **C: tinggal 86 GB** | **Tinggi** | ADR-004: seluruh volume infrastruktur diarahkan ke D:; C: hanya untuk kode & model |
| R3 | **Membangun di repo legacy merusak produksi** | **Tinggi** | ADR-001: repo baru terpisah, legacy tetap berjalan |
| R4 | Port 3000 dipakai daemon legacy | Sedang | Aether OS memakai rentang port berbeda (8080+) |
| R5 | Rahasia legacy terekspos di repo | Sedang | Aether OS memakai secret storage sejak awal; jangan salin `configs/` |
| R6 | Isolasi klien router | Sedang | Tailscale sebagai jalur utama lintas-perangkat |
| R7 | IP LAN dari DHCP | Rendah | Rekomendasi reservasi DHCP di router |
| R8 | Image Docker bisa hilang lagi (containerd snapshotter) | Sedang | Compose deklaratif + skrip bootstrap agar stack dapat dibangun ulang |
| R9 | E: disk dinamis, 292 GB tak terpakai | Rendah | Diterima; D: dijadikan drive infrastruktur utama |

---

## 10. Rekomendasi

### Segera (Phase 0 → 1)

1. **Repo baru terpisah** di `C:\Workspace\AetherOS` — legacy tetap hidup sebagai referensi & produksi (ADR-001).
2. **Python + TypeScript**, bukan JavaScript polos (ADR-002).
3. **Data infrastruktur ke D:\AetherOS\data** — C: tidak cukup (ADR-004).
4. **Tunda Rust/Tauri** sampai Milestone 0.5. Shell desktop bukan jalur kritis; Rust toolchain ± 2 GB di C: yang sudah sempit (ADR-005).
5. **Jangan salin `configs/` legacy** — kredensial harus lahir ulang di secret storage.

### Bertahap

6. Naikkan infrastruktur **satu per satu dengan verifikasi**, bukan sekaligus: PostgreSQL → Qdrant → Neo4j → MinIO.
7. Pulihkan stack suara **setelah** fondasi berdiri; ia bukan jalur kritis Milestone 0.1.
8. Reservasi DHCP untuk 192.168.1.8 di router.

### Yang sengaja ditunda

| Item | Alasan |
|---|---|
| CCTV | Belum ada kamera terpasang di jaringan |
| Home automation | Home Assistant tidak ditemukan di LAN (pindaian port 8123 nihil) |
| Robotics | Di luar cakupan; abstraksi tetap dijaga bersih (§216) |
| Mobile app | Desktop adalah target utama |

---

## 11. Kesimpulan

Lingkungan **siap** untuk Aether OS dengan tiga syarat arsitektural:

1. Arsitektur harus **jujur soal ketiadaan GPU** — bukan menyembunyikannya di balik asumsi CUDA.
2. Data infrastruktur **tidak boleh** diletakkan di C:.
3. Sistem legacy **tidak boleh** disentuh sampai penggantinya terbukti bekerja.

Empat pertanyaan verifikasi §276 yang sudah bisa dijawab sekarang:

- *Can Aether operate offline?* — Ya. Otak lokal in-process + model GGUF tersedia dan terukur.
- *Can Aether use tools?* — Legacy sudah membuktikan konsepnya (75 tool aktif).
- *Can Aether remember?* — Legacy punya memori SQLite + vector; konsepnya terbukti, implementasinya perlu ditulis ulang.
- *Can Aether verify actions?* — **Belum.** Tidak ada verification engine di legacy. Ini gap terbesar.
