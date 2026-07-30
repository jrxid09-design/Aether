# Aether Multi-Agent

Aether bukan satu model — ia bisa mendelegasikan tugas ke beberapa
"pekerja" dan mengoordinasikannya (gaya Hermes-agent).

## Agent

| Agent | Peran |
|---|---|
| **aether** | Otak LLM lokal: menalar, menulis, menghitung, memakai memori & tool internal. Default untuk berpikir. |
| **openclaw** | "Tangan digital" — mengoperasikan aplikasi desktop/website tanpa API (klik, isi form). Untuk AKSI di antarmuka. |
| **hermes** | Runtime agent terpisah untuk tugas agentik berlapis. |

Aether-LLM selalu tersedia (lokal). OpenClaw & Hermes disambungkan
lewat `configs/integrations.json` dan dipakai bila online — kalau
offline, orkestrasi tetap jalan dan langkah itu ditandai gagal, bukan
menjatuhkan semuanya.

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
  pakai model kuat (Ollama lokal yang mumpuni atau platform berbayar
  lewat Settings).
- OpenClaw & Hermes: bentuk API tiap instance bisa beda; konektor
  memakai gaya OpenAI chat-completions sebagai default dan bisa
  disesuaikan di `configs/integrations.json`. Verifikasi ke instance
  sungguhan dilakukan saat keduanya online.
