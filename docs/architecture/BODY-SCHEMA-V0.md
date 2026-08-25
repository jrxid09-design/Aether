# Body Schema + Sensorium V0 — Arsitektur

Status: **V0 (kandidat terisolasi)** — basis `2890f961`, cabang
`feat/body-schema-sensorium-v0`.

## Posisi dalam tubuh Aether

```
Sensorium  →  BodySchema  →  Cognition  →  Authority  →  Actuation
(indrawi)     (representasi)   (ACC)        (terpisah)    (TIDAK di V0)
```

V0 membangun dua lapis pertama saja. Tidak ada aktuasi produksi, tidak ada
penulisan ACC/AetherSelf, tidak ada Presence/Voice/wakeword.

## Penomoran bagian (B§)

| Bagian | Isi | Berkas |
|---|---|---|
| B§0 | Pintu publik tunggal | `src/embodiment/index.js` |
| B§1 | Utilitas dasar (freeze/digest/jam) | `src/embodiment/core/util.js` |
| B§2 | Tipe domain (enum tertutup) | `src/embodiment/domain/types.js` |
| B§3 | Identitas kanonik perangkat | `src/embodiment/core/identity.js` |
| B§4 | Deskriptor + klaim kemampuan | `src/embodiment/domain/descriptor.js` |
| B§5 | Amplop event sensorium | `src/embodiment/sensorium/events.js` |
| B§5a–c | Kontrak adapter discovery | `src/embodiment/discovery/*` |
| B§6 | BodySchema kanonik | `src/embodiment/schema/BodySchema.js` |
| B§7 | Proyeksi model-diri (baca-saja) | `src/embodiment/schema/EmbodimentSummary.js` |
| B§8 | Persistensi (memori; titik integrasi sqlite) | `src/embodiment/persistence/BodyStore.js` |

## Prinsip inti

**PERANGKAT ≠ KEMAMPUAN ≠ OTORITAS.** Menemukan mikrofon berarti mencatat:
"ada benda yang mengaku bisa `audio.capture`, dengan provenance X dan
confidence Y". Itu bukan izin. Izin adalah ranah Authority yang dibangun
terpisah — modul ini bahkan tidak punya tempat dalam bentuk datanya untuk
menyatakan izin (lihat invariant A).

### Jalur tulis tunggal (B§6)

Satu-satunya mutasi state adalah `BodySchema.ingest(event)`. Event hanya
diterima dari produsen terdaftar (`registerProducer`) — yaitu adapter
discovery yang dipasang operator, atau `sensorium.core` untuk event
turunan. Event cacat / produsen asing dicatat ke dead-letter tanpa
mengubah state apa pun.

### Identitas kanonik (B§3)

`<namespace>:<stable-key>` — mis. `windows.audio:{0.0.1.00000000}.1`,
`usb:1234:5678:abc`, `network:rtsp:kamera-luar`. Nama tampilan tidak pernah
menjadi identitas. Adapter wajib jujur soal kestabilan lewat klaim
`identity.stability = stable|session|ephemeral`; bila sumber tidak
menyediakan pengenal stabil, dipakai `unverified-<hash>` (B§3).

### Penggabungan observasi (urutan total, bebas arah kedatangan)

Antar-pengamatan atas perangkat yang sama diselesaikan dengan urutan total:
confidence menurun → sumber leksikografis naik → waktu terbaru → digest
kanonik. State (kehadiran) mengikuti pengamatan terbaru secara temporal —
rediscovery selalu dapat memulihkan perangkat yang offline/removed.

### Ephemeral vs durable (B§8)

Observasi sensor (`SENSOR_OBSERVATION`) adalah **ephemeral**: cincin memori
terbatas, tidak pernah diserialisasi. Identitas/kemampuan/relasi/preferensi
adalah **durable**: `serialize()` → store. V0 menyediakan store memori;
titik integrasi sqlite masa depan terdokumentasi di
`persistence/BodyStore.js` (tanpa menyentuh internal database yang sudah
ada).

## Invariant keamanan (dibuktikan di `tests/embodiment/securityInvariants.test.js`)

- **A.** Field otoritas (`authority`, `grants`, `permission`, ...) ditolak
  whitelist deskriptor — penemuan secara struktural tidak bisa membawa kuasa.
- **B.** Produsen tak terdaftar dead-letter; event kehadiran/perubahan untuk
  perangkat tak dikenal ditolak. Teks tidak bisa menciptakan perangkat.
- **C.** Snapshot/view beku penuh; rekaman internal diganti utuh, tidak pernah
  diubah di tempat.
- **D.** Klaim kemampuan hanya boleh `{name, confidence, source, claimedAt}` —
  fakta + provenance, bukan izin.
- **E.** Perangkat `UNKNOWN` tetap unknown sampai ada bukti klasifikasi dari
  pengamatan eksplisit yang menang urutan total.
- **F.** Observasi sensor hanya masuk ring buffer; tidak ada API eksekusi
  aktuator di seluruh permukaan modul.
- **G.** BodySchema hidup tanpa Console/LLM/database (dibuktikan adapter fake).

## Kait masa depan (non-executing)

- **Reverse Engineering Intelligence:** event `UNKNOWN_DEVICE_REQUIRES_ANALYSIS`
  otomatis untuk perangkat UNKNOWN baru, membawa bukti (digest deskriptor,
  kemampuan, provenance, identitas, metadata). Engine RE-nya sendiri BUKAN
  bagian V0.
- **Sistem saraf otonomik:** `body.subscribe(fn)` memberi event beku kepada
  pelanggan (mis. "mikrofon preferred hilang" → turunan
  `DEVICE_DEFAULT_CHANGED`). Tidak ada aksi bawaan; refleks produksi tetap
  harus lewat Authority.
- **Authority (Evolution Authority, dibangun terpisah):** integrasi kelak
  cukup membaca kanal/kemampuan dari proyeksi ini; tidak ada duplikasi sistem
  otoritas di sini.

## Batas milestone V0

Tidak termasuk: Presence Orb, wakeword, double slap, streaming TTS/ASR,
capture produksi kamera/mikrofon, kontrol keyboard/mouse, automasi OS,
engine reverse engineering, driver otonom, Evolution Authority, mutasi
AetherSelf, Colony, ACC C1.

## Menjalankan tes

```bash
node --test tests/embodiment/*.test.js
```

34 tes, deterministik (jam manual, adapter fake, tanpa perangkat keras).
