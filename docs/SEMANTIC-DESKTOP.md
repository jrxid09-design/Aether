# SEMANTIC DESKTOP — Substrat Konteks Desktop V0

Dokumen ini menjelaskan substrat **Semantic Desktop**: sistem yang
menjawab *"apa yang sedang terjadi di komputer ini sekarang?"* — bukan
sekadar *"proses apa yang berjalan?"*. Lokasi: `src/desktop/`, tes:
`tests/desktop/`.

Status: **V0 deterministik, observasi saja**. Tidak ada actuation OS,
tidak ada tangkapan layar kontinu, tidak ada integrasi daemon produksi.

---

## Prinsip inti: RAW OS STATE != SEMANTIC CONTEXT

```
raw:    process = notepad.exe ; window = "catatan.txt - Notepad"
semantic:
  entity  DOCUMENT catatan.txt
  rel     DISPLAYED_IN → WINDOW → ACTIVE_IN → APPLICATION notepad
  role    currently_editing
```

Setiap entitas membawa `provenance` (dari adapter mana) dan
`confidence` (seberapa yakin). Seleksi teks ≠ teks clipboard sembaran;
konteks visual aktif ≠ screenshot desktop; halaman browser ≠ proses
browser.

## Peta konsep

| Konsep | Isi |
|---|---|
| `types.js` | ENTITY_TYPE (13), RELATIONSHIP (10), DESKTOP_EVENT (10), TRANSITION, REASON_CODE |
| `ContextEntity.js` | Entitas immutable ber-revisi; perubahan = revisi baru, bukan mutasi |
| `ContextObservation.js` | Validasi event; event cacat ditolak dengan kode diagnostik |
| `DesktopContextCore.js` | Keadaan kanonik: graf entitas+relasi, pointer aktif, riwayat transisi berbatas, invalidasi |
| `ContextSnapshot.js` | Snapshot deep-frozen + serialize/deserialize (paritas rebuild) |
| `ContextReferenceResolver.js` | Resolusi deterministik "ini / gambar ini / yang tadi" → status+targets+confidence+provenance+reasonCode |
| `CognitionProjection.js` | Jembatan BACA-SAJA untuk Presence/ACC/Vision masa depan |
| `adapters/FakeDesktopAdapter.js` | Adapter deterministik pembuktian lifecycle & skenario |
| `adapters/WindowsActiveWindowAdapter.js` | Satu-satunya adapter nyata: polling metadata jendela latar depan via PowerShell bawaan |

## Aturan mutlak

1. **Satu jalur mutasi.** Keadaan kanonik hanya berubah lewat
   `core.ingest()` dari adapter TERDAFTAR + tepercaya. Output model
   secara struktural tidak bisa memproduksi observasi.
2. **Idempoten.** Observasi dedupe by `observationId`; duplikat ditolak.
3. **Invalidasi deterministik.** Menutup jendela menginvalidasi
   dokumen/seleksi/visual anaknya (`staleReason=WINDOW_CLOSED`);
   seleksi/dokumen/clipboard baru membuat yang lama basi
   (`SUPERSEDED_*`). Entitas basi disimpan dengan alasan, tidak
   dihapus diam-diam.
4. **Riwayat berbatas.** Ring buffer transisi (default 50) untuk frasa
   seperti "yang tadi" — bukan surveillance sejarah tanpa batas.
5. **Tidak menebak.** Resolver dengan beberapa kandidat sama-sama sah
   mengembalikan `status:"ambiguous"` + kandidat, bukan pilihan senyap.

## Resolusi referensi

```js
resolver.resolve(view, { kind: "current_selection" })
resolver.resolve(view, { kind: "active_visual" })
resolver.resolve(view, { kind: "selected_files" })
resolver.resolve(view, { kind: "recent_context",
                         constraints: { transitionTypes: ["selection_changed"] } })
// → { status: resolved|ambiguous|unavailable,
//     targets, candidates, confidence, provenance, reasonCode }
```

Kandidat bahasa ("ini", "gambar ini", "file ini") diterjemahkan lapisan
bahasa menjadi permintaan terstruktur di atas — resolver sengaja tanpa
NLU.

## Minimisasi konten (privacy)

- Metadata/event secara default; konten sensitif hanya via akuisisi
  eksplisit masa depan.
- Seleksi: panjang + cuplikan ≤120 char dari adapter, bukan dump
  dokumen.
- Visual: **reference-first** — `captureRequired:true`, tanpa byte
  gambar; "Aether, lihat ini" kelak menembak capture satu sumber
  relevan, bukan layar penuh berkala.
- Clipboard: representasi item terakhir metadata-only; TIDAK ada
  history clipboard.
- Cookie/kredensial browser: bukan bagian substrat ini, selamanya.

## Batasan dengan sistem lain (tidak digabung)

| Sistem | Pertanyaan yang dijawab | Relasi |
|---|---|---|
| **Context Intelligence** (`src/ai/context/`) | "Informasi apa yang masuk prompt giliran ini?" | Pipeline prompt. Semantic Desktop adalah calon SUMBER baru bagi pipeline itu kelak; V0 tidak menyentuhnya sama sekali |
| **Sensorium / Body Schema** (Ox #2) | "Perangkat/indra apa yang dimiliki Aether?" | Batas bersih: Sensorium = tubuh, Semantic Desktop = lingkungan digital pemilik. Presence kelak mengonsumsi keduanya. Tidak ada import |
| **Authority** (masa depan) | "Bolehkah Aether bertindak?" | Observasi memberi NOL otoritas. Tahu paragraf terpilih ≠ boleh menimpanya. Logika otoritas tidak diduplikasi di sini |

Proyeksi kognisi (`createCognitionProjection`) beku: hanya metode query
+ `interpret()` yang murni anotasi lokal — keadaan kanonik terjamin
byte-per-byte sama sebelum/sesudah.

## Hook Windows UI Automation (masa depan)

Alur calon: active window → accessibility tree → elemen semantik
fokus → dokumen/seleksi. V0 hanya menyediakan titik jangkar observasi
(`WindowsActiveWindowAdapter`, metadata judul+PID); tidak ada produksi
UI Automation actuation.

## Env / persistence

In-memory bounded saja. Snapshot punya serialize/deserialize untuk audit
dan rebuild parity — tanpa arsitektur database kedua; persistensi ACC
tersertifikasi tidak disentuh.

## Test

```bash
node --test --test-concurrency=1 --require ./tests/helpers/testEnv.js "tests/desktop/*.test.js"
```

35 tes mencakup matriks: aktivasi aplikasi/jendela, dokumen, seleksi
teks & file, visual, workspace, clipboard, riwayat & batas, snapshot
immutable & pemisahan live, idempotensi, invalidasi basi/window-close,
relasi, resolusi semua kind, ambiguitas, reason deterministik,
provenance/confidence, event cacat, UNKNOWN aman, lifecycle adapter,
model-boundary, nol otoritas, minimisasi, anti-screenshot-kontinu,
referensi visual tanpa byte, mandiri tanpa Console, parity
serialisasi.
