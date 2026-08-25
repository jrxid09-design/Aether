# Aether Multi-Agent

Aether bukan satu model — ia bisa mendelegasikan tugas ke beberapa
"pekerja" dan mengoordinasikannya.

## Agent

| Agent | Peran |
|---|---|
| **aether** | Otak LLM lokal: menalar, menulis, menghitung, memakai memori & tool internal. Default untuk berpikir. |
| **10 anak buah** | Spesialis berbasis peran di runtime yang sama: vanta (riset), forge (coding), nexus (sistem), sera (vision), echo (suara), cipher (keamanan), atlas (otomatisasi), mira (memori), pulse (monitoring), lumen (antarmuka). |

Semua agent hidup di runtime Aether yang sama — selalu online selama
daemon berjalan.

## Cara kerja orkestrasi

Permintaan kompleks tidak dijawab satu tembakan:

```
1. RENCANA  — Aether-LLM memecah tugas jadi langkah, tiap langkah
              ditugaskan ke agent paling cocok (output JSON).
2. EKSEKUSI — tiap langkah dijalankan berurutan; hasil langkah
              sebelumnya diteruskan sebagai konteks.
3. SINTESIS — Aether-LLM merangkum hasil jadi jawaban akhir.
```

Setiap tahap memancarkan event (planning → plan → step:start →
step:done → final), jadi prosesnya terlihat langsung di Console
(halaman **Agents**) — bukan sekadar hasil akhir.

Kalau permintaannya sederhana, perencana cukup membuat satu langkah
`aether` dan jawabannya langsung dipakai.

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
- Anak buah memakai tool sesuai topiknya (profil per agent) — lihat
  `src/agent/agentTools.js`.
