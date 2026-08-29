# Damar & Pandawa

Damar bukan satu model — ia bisa mendelegasikan tugas ke **Pandawa**,
kolektif lima spesialis miliknya, lalu mengoordinasikan hasilnya.

```
                       Damar
            identitas & kognisi kanonik
                         │
                         ▼
                      Pandawa
                         │
   ┌────────────┬────────┼────────┬────────────┐
   ▼            ▼        ▼        ▼            ▼
Puntadewa   Werkudara  Janaka   Nakula      Sadewa
tata kelola  keamanan   riset   rekayasa   memori &
& rencana  & pertahanan & intel & operasi  kontinuitas
```

## Agent

| Agent | Peran |
|---|---|
| **damar** | Otak LLM lokal: menalar, menulis, menghitung, memakai memori & tool internal. Default untuk berpikir. |
| **puntadewa** | Tata kelola, perencanaan & penilaian: dekomposisi tugas, rencana jangka panjang, analisis keputusan, koordinasi, prioritisasi, resolusi konflik, interpretasi kebijakan. |
| **werkudara** | Keamanan & pertahanan: pemodelan ancaman, tinjauan autentikasi/otorisasi, analisis batas kepercayaan, telaah rahasia & risiko dependensi, pengerasan runtime, uji adversarial, analisis insiden. |
| **janaka** | Riset & intelijen: investigasi dokumentasi, akuisisi pengetahuan eksternal, OSINT, perbandingan pustaka/API/produk, verifikasi fakta, sintesis informasi. |
| **nakula** | Rekayasa & operasi: implementasi, debugging, refactoring, testing, DevOps, operasi runtime, kontainer/layanan, integrasi, otomatisasi, performa, integrasi perangkat/tool. |
| **sadewa** | Memori, analisis & kontinuitas: organisasi memori, provenance, klasifikasi epistemik, kontinuitas historis & percakapan, analisis data, pengenalan pola, refleksi pasca-tugas. |

Semua agent hidup di runtime Damar yang sama — selalu online selama
daemon berjalan. Sintesis akhir ke pengguna tetap **Damar**; Pandawa
tidak tampil sebagai lima asisten terpisah.

## Batas kewenangan Pandawa

Pandawa adalah unit spesialis, **bukan akar otoritas**. Tidak ada
anggota yang mendapat kewenangan tambahan karena perannya:

| Hukum | Artinya |
|---|---|
| `PLAN != AUTHORITY` | Puntadewa menyusun rencana; rencana tidak memberi izin. |
| `MEMORY != AUTHORITY` | Sadewa menyediakan konteks & provenance; sesuatu tidak menjadi boleh hanya karena tercatat. |
| `SECURITY != BYPASS` | Werkudara meninjau keamanan; ia tetap tunduk pada Authority Gate dan kill switch. |
| `RESEARCH != TRUTH` | Janaka meneliti; temuan wajib membawa sumber & tingkat keyakinan. |
| `ENGINEERING != FREE EXEC` | Nakula merekayasa; setiap aksi nyata tetap melewati Actuation Fabric. |
| `MODEL CLAIM != AUTHORITY` | Model menentukan CARA berpikir, bukan SIAPA Damar. |
| `CHANNEL != AUTHORITY` | Kanal memilih konteks, bukan hak. |

Secara teknis: `AgentHub.run()` menurunkan peran worker lewat
`delegatedRoleOf(exec)` — worker **mewarisi** otoritas delegator dan
tidak pernah menaikkannya — lalu `assertRestrictionsPreserved()`
gagal-keras bila `capabilitySet` hilang di transit. Seleksi tool juga
disaring oleh `capabilitySet` yang sama, sehingga worker terbatas tidak
pernah *melihat* kandidat di luar setnya.

Nama kolektif lama masih dikenali sebagai alias yang DEPRECATED
(`vanta→janaka`, `cipher→werkudara`, `atlas→puntadewa`,
`forge|nexus|sera|echo|lumen→nakula`, `mira|pulse→sadewa`,
`aether→damar`); alias tidak pernah muncul sebagai agent kedua di
`agents()`. Lihat `docs/architecture/DAMAR-IDENTITY-MIGRATION.md`.

## Cara kerja orkestrasi

Permintaan kompleks tidak dijawab satu tembakan:

```
1. RENCANA  — Damar-LLM memecah tugas jadi langkah, tiap langkah
              ditugaskan ke agent paling cocok (output JSON).
2. EKSEKUSI — tiap langkah dijalankan berurutan; hasil langkah
              sebelumnya diteruskan sebagai konteks.
3. SINTESIS — Damar-LLM merangkum hasil jadi jawaban akhir.
```

Setiap tahap memancarkan event (planning → plan → step:start →
step:done → final), jadi prosesnya terlihat langsung di Console
(halaman **Agents**) — bukan sekadar hasil akhir.

Kalau permintaannya sederhana, perencana cukup membuat satu langkah
`damar` dan jawabannya langsung dipakai.

## Antarmuka

- **Console → Agents**: kartu kesiapan tiap agent + konsol orkestrasi
  dengan langkah-langkah tampil realtime.
- **API**:
  | Method | Endpoint | Guna |
  |---|---|---|
  | GET | `/console/agents` | Kesiapan tiap agent |
  | POST | `/console/orchestrate` | Jalankan orkestrasi (SSE: planning/plan/step/final) |

## Catatan

- Kualitas rencana bergantung pada model AI aktif. Untuk hasil bagus,
  pakai model kuat (model lokal yang mumpuni atau platform berbayar
  lewat Settings).
- Pandawa memakai tool sesuai topiknya (profil per anggota) — lihat
  `src/agent/agentTools.js`.
