# ACC C0 IMPLEMENTATION REPORT — checkpoint saat operator away

## CURRENT_ACC_PHASE
C0.8 (kode seluruh fase C0.1–C0.7 + lab ditulis; SEMUA gate machine
berstatus **PENDING-GATE** — eksekusi node tidak tersedia di sesi WSL ini,
runner disiapkan di `scripts/acc-gates.ps1`).

## COMPLETED_PHASES
- C0.0 Discovery + Contract: **DELIVERED** (`docs/architecture/ACC-C0.md`).
- C0.1–C0.8: kode + tes lengkap tertulis, status gate **PENDING-GATE**.

## FAILED_GATES
Belum ada yang dieksekusi → tidak ada fail tercatat; tidak ada klaim pass.

## BLOCKERS
- BLOCKED(runtime): WSL interop mati (`exec format error` pada node.exe);
  registrasi binfmt butuh root. Maksimal 3 percobaan pemulihan mandiri
  sudah dilakukan sebelumnya dan gagal → lanjut kerja independen sesuai §8.

## BASELINE
- Branch `feat/acc-c0` dari commit `431c3b21d16246ab2770332789523b272c57e3cc`
  (branch `opensource`), 720 entri kerja lama dipertahankan utuh.
- Tidak ada reset/squash/clean; hanya file ACC baru + migrasi additive +
  satu baris script npm.

## FILES_CHANGED (ACC-owned)
- src/cognition/** (index, config, core, continuity+reducers, self/epistemics,
  affect engine+appraisal, interoception bus, workspace, witness+meta,
  prediction, autobiography, substrate router/request/proposal,
  persistence store, integration adapter)
- src/memory/db/migrations/008_acc.sql (additive)
- tests/cognition/*.test.js (6 file, ±40 kasus)
- scripts/acc-gates.ps1; package.json (+`test:acc`)
- docs/architecture/ACC-C0.md, docs/security/ACC-boundary.md,
  docs/research/ACC-C0-experiments.md, laporan ini

## FOUNDATION_FILES_TOUCHED
TIDAK ADA. `FOUNDATION_CHANGE_REQUIRED`: tidak ada entri.

## TEST_TOTALS
PENDING-GATE (lihat `scripts/acc-gates.ps1`; output `.tmp-closure/acc-gates.log`).
Estimasi kasus: kontinuitas 5 · epistemics 6 · affect/interoception 4 ·
workspace 4 · witness/meta/prediction 3 · bio/substrate/security/off 9.

## SECURITY_REGRESSIONS
Tidak dapat dinyatakan sampai foundation regression step dieksekusi;
desain memastikan nol sentuhan ke modul bersertifikat dan ada uji
dep-direction + shadow-parity + off-mode zero-trace.

## PERFORMANCE_MEASUREMENTS
Belum diukur (butuh eksekusi). Reducer inti deterministic & tanpa LLM call
(§85); overhead harapan: I/O jurnal SQLite per event pada mode shadow.

## NEGATIVE_RESULTS
- Sweep TTL/habituation sengaja KELUAR dari jalur reducer agar replay
  deterministik — workspace kanonik dibangun murni dari event; sweep
  menjadi pertimbangan view-level saja.
- Significance default threshold 0.35: SUBSTRATE_CHANGED sendirian TIDAK
  cukup signifikan tanpa faktor lain — disengaja (mencegah autobiografi
  dari noise pergantian model).

## BACKLOG (non-blocking, tidak menahan milestone C0)
1. Reconciliation upsert-only: baris hantu yang diinjeksi manual ke tabel
   projeksi tidak dipangkas (hanya ditimpa bila event sumber direplay).
2. sqlite lastJournalRow mem-parse payload; memory backend mengembalikan
   objek apa adanya — divergensi kosmetik bentuk internal.
3. acc-gates.ps1 log path masih relatif worktree (portability).
4. DEP-DIR test memakai daftar file foundation yang di-hardcode.
5. Journal compaction/checkpoint otomatis belum diimplementasi.
6. Tidak ada alarm operasional untuk projection health (dirty watermark).

## NEXT_SAFE_ACTION
1. Operator/Claude menjalankan `powershell -File scripts\acc-gates.ps1`.
2. Jika hijau → tandai fase PASS dengan angka mesin, lalu jalankan
   foundation regression penuh (`npm run test:safety`) sebagai gerbang akhir.
3. Jika merah → diagnosis bounded dalam kode ACC (maks 3 varian), tanpa
   menyentuh foundation.
4. Tag `foundation-hardened-v1` tetap MENUNGGU sertifikasi delta Claude.
