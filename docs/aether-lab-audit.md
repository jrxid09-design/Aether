# AETHER LAB — AUDIT ARSITEKTUR & RENCANA IMPLEMENTASI

> Status: AUDIT (fase #45 spec). Tidak ada kode Lab yang diubah dokumen ini dibuat.
> Menunggu persetujuan user sebelum implementasi dimulai.

---

## 1. PETA ARSITEKTUR SAAT INI

### 1.1 Inti runtime (semua ADA & dipakai)

| Subsistem | Lokasi | Kondisi | Reusability utk Lab |
|---|---|---|---|
| **AgentHub** (11 agent: aether + 10 worker) | `src/services/agentHub.js` (380 baris) | Aktif; worker = chat + bias peran | TINGGI — registry agent kanonik |
| **Profil tool per-agent** | `src/agent/agentTools.js` (WORKER_PROFILES + CAPABILITY_ALIAS → resolver `tail()`) | Aktif; resolve vs registry nyata (186 tool) | TINGGI — ini persis §10 spec |
| **Orkestrator** (plan → step → final, SSE) | `src/services/orchestrator.js` (224 baris) | Aktif; planner LLM + fallback 1-langkah | TINGGI — mesin eksekusi misi |
| **OpenCode bridge** | `src/services/opencodeTools.js` (`opencode_run`, sesi per-purpose in-memory, WSL-aware) | Aktif teruji | TINGGI — butuh sesi persisten (§12) |
| **AI Runtime** (model-agnostic, multi-provider, fallback) | `src/services/aiRuntimeService.js` (1088 baris) + `src/ai/**` | Aktif; provider openai-compatible + otak lokal llama.cpp, switch model runtime | TINGGI — §2 & §35 sudah terpenuhi |
| **Memory Engine** (LTM/KG/STM/retrieval/consolidation) | `src/memory/**` (11 subsistem) | Aktif; SQLite `data/memory.db` | TINGGI — perlu scope PROJECT (§16) |
| **Knowledge/Document ingest** | `src/memory/services/DocumentService.js` + extractors + `scripts/ingest-knowledge.js` | Aktif (174+ dokumen 5 repo) | TINGGI — basis Knowledge Lab §17 |
| **Governance** (proposal/approve/audit) | `src/memory/governance/Governor.js` | ADA tapi **dimatikan** (auto-commit per kebijakan user) | DIPAKAI ULANG sebagai approval gate §32 |
| **Telemetry/Event bus** (SSE) | `src/services/telemetryService.js` → `/events` SSE → Console | Aktif; 30+ tipe event publish | TINGGI — basis §15/§33, perlu event Lab baru |
| **ToolGuard** (kill switch, risk, path, loop, verify, audit) | `src/core/safety/**` + `core/verify/VerificationEngine.js` | Aktif di 2 jalur eksekusi tool | TINGGI — §37 sebagian jadi |
| **ToolForge** (Aether bikin tool sendiri) | `src/services/toolForge.js` + `forgeTools.js` | Aktif (draft → approve) | SEDANG — pola approval reusable |
| **Terminal Runtime** (pty persisten by purpose) | `src/runtime/terminal/**` | Aktif | TINGGI — instrumen Terminal §13 |
| **Skill/plugin system** | `src/plugins/**` + userPlugins | Aktif, 12 plugin bawaan | TINGGI |

### 1.2 Frontend Console

| Komponen | Lokasi | Kondisi |
|---|---|---|
| App shell + navigasi APPS + launcher | `apps/console/renderer/app.js` (844) | Aktif; lab sudah terdaftar sebagai app |
| View Lab v1 (Projects/Chat/Agents sederhana) | `views/labProjects.js`, `labChat.js`, `labAgents.js`, `apps/lab.js` | **BARU DIBUAT** — menjadi dasar rombak |
| Agent Bus → orb visual | `lib/agentBus.js` + `avatar/swarmOrbs.js` | Aktif (mood + engage/release) |
| Home bubbles / task timeline | `lib/homeBubbles.js` | Aktif |
| Memory view (graph/browse/search/entities/documents) | `views/memory.js` | Aktif |
| Hologram orb (THREE.js swarm) | `lib/avatar/entity.js` | Aktif |

### 1.3 Persistensi

- `data/memory.db` (SQLite): memories, entities, relations, edges, documents, chunks, embeddings, **memory_audit, memory_proposals** (schema governance sudah ada!)
- `data/aether.db`: sesi/device/runtime
- `configs/*.json` (JsonStore): providers, roles, safety, **lab.json (project list v1)**
- Filesystem: `downloads/chat-uploads`, userPlugins

### 1.4 Ketidakcocokan vs spesifikasi Lab (konflik)

| Konflik | Keterangan | Resolusi usulan |
|---|---|---|
| Orkestrator stateless | Plan → run → selesai; tak ada Mission persisten | Bungkus dengan MissionEngine (baru), orchestrator jadi executor |
| Worker agent tanpa sesi/status | `runWorker` = 1 chat call; tak ada state agent hidup (IDLE/WORKING/…) | AgentStatusService dengan TTL + event-driven |
| opencode sesi in-memory | Hilang saat restart | Simpan opencode session id di DB misi (kolom sesi) |
| Memori tanpa scope project | metadata.scope ada di taksonomi tapi tak dipakai Lab | Isi `scope = projectId` pada jalur tulis Lab |
| Governance dimatikan total | User minta memori bebas; §32 minta approval untuk aksi berbahaya | PISAH: memori = auto (tetap); aksi destruktif = gate BARU via mission state WAITING_USER |
| Lab v1 = daftar folder + 2 chat | Jauh dari mission control | Rombak UI (lihat §6) |

---

## 2. GAP ANALYSIS (yang BELUM ADA)

1. **Project entity kaya** — kini hanya `{id, dir, title}` di lab.json. Kurang: goal/status/phase/timeline/config/dependencies.
2. **Mission system** — tidak ada sama sekali (state machine §7, tasks, progress deterministik).
3. **Agent live status** — tidak ada (hanya agentBus transient UI-side).
4. **Instrument abstraction** — tidak ada (user melihat tool mentah; §13 minta konsep instrumen).
5. **Activity stream persisten & machine-readable** — telemetry hanya ring buffer + SSE, tak di-DB; UI tak bisa replay.
6. **Artifact registry** — tidak ada provenance artefak.
7. **Decision records** — tidak ada.
8. **Experiment + Test Chamber** — tidak ada (code_test tool ada, tapi tak terstruktur sebagai eksperimen/verifikasi misi).
9. **Project timeline / Time Machine data model** — tidak ada.
10. **Phase-aware agent routing** — orchestrator prompt menyebut peran tapi tak pakai project phase (§5).
11. **Deterministik state transitions** — semua status = teks; tidak ada validator transisi.
12. **Approval gate runtime** (WAITING_USER di misi) — tidak ada jalur deterministik (hanya toolGuard menolak).

---

## 3. ARSITEKTUR USULAN

```
USER (Console Lab / CLI)
   │
   ▼
LabService  (facade API — satu pintu /lab/*)
   ├─ ProjectEngine     (CRUD project, phase machine, timeline index)
   ├─ MissionEngine     (state machine §7, tasks, delegasi → orchestrator)
   ├─ AgentStatusBoard  (state agent hidup, TTL, dari event)
   ├─ InstrumentCatalog (map konsep instrumen → tool nyata, resolve via agentTools)
   ├─ ArtifactRegistry  (provenance: mission/agent/source/decisions)
   ├─ DecisionLog       (ADR-style)
   ├─ ExperimentLab     (hypothesis/runs/metrics — fondasi)
   ├─ TestChamber       (kategori test → code_test runner / smoke)
   └─ ActivityLog       (event persisten SQLite + tepan ke telemetry SSE)
        │
        ▼  (eksekusi tetap lewat infrastruktur yang ADA)
   orchestrator.run() → agentHub.run() → profil agentTools → ToolGuard → AITool registry
                                                        ↘ opencode_run (sesi persisten per misi)
```

Prinsip: **MissionEngine = otak organisasi; orchestrator/agentHub/tool = otot yang sudah ada.** Tidak ada runtime paralel (§42).

## 4. DATA MODEL (SQLite, migrasi baru `005_lab.sql`)

```sql
lab_projects (id TEXT PK, dir, title, goal, description,
  status TEXT DEFAULT 'active',            -- active|paused|archived
  phase TEXT DEFAULT 'IDEA',               -- §5: IDEA..MAINTENANCE
  config JSON, created_at, updated_at)

lab_missions (id TEXT PK, project_id FK, title, objective,
  status TEXT DEFAULT 'PLANNING',          -- §7 (9 state)
  priority INT DEFAULT 3, owner_agent TEXT,
  plan JSON, progress REAL DEFAULT 0,      -- dihitung dari tasks (deterministik)
  opencode_session TEXT, opencode_dir TEXT, opencode_branch TEXT, -- §12
  error TEXT, created_at, updated_at)

lab_tasks (id TEXT PK, mission_id FK, title, agent TEXT,
  status TEXT DEFAULT 'pending',           -- pending|running|done|failed|skipped
  output TEXT, tool_trace JSON, created_at, updated_at)

lab_artifacts (id TEXT PK, project_id, mission_id, agent_id,
  kind TEXT, path TEXT, uri TEXT, summary TEXT,
  provenance JSON,                         -- {source, tool, decisions[], experiment}
  created_at)

lab_decisions (id TEXT PK, project_id, mission_id,
  question TEXT, options JSON, chosen TEXT, reason TEXT,
  evidence JSON, decision_maker TEXT, created_at)

lab_experiments (id TEXT PK, project_id, hypothesis, objective,
  variables JSON, method TEXT, metrics JSON, runs JSON,
  conclusion TEXT, status TEXT, created_at, updated_at)

lab_events (id INTEGER PK AUTOINCREMENT, ts, type TEXT,        -- §33 vocab
  project_id, mission_id, agent_id, tool, payload JSON)

lab_snapshots (id TEXT PK, project_id, label, git_commit,
  mission_states JSON, artifact_ids JSON, decision_ids JSON,
  memory_refs JSON, created_at)             -- §23 MVP: data model saja
```

**Event vocabulary (§33):** `project.created|phase_changed`, `mission.created|started|blocked|waiting_user|verifying|completed|failed|cancelled`, `agent.started|completed|failed`, `tool.started|completed|failed`, `artifact.created`, `decision.created`, `experiment.started|completed`, `test.started|completed|passed|failed`, `memory.updated`.
Semua event ditulis ke `lab_events` (kebenaran) DAN di-`telemetry.publish("lab:...")` (stream UI).

**State machine misi (deterministik, runtime-bukan-prompt):**
```
PLANNING→QUEUED→RUNNING→{VERIFYING→COMPLETED | BLOCKED | WAITING_USER | FAILED | CANCELLED}
TRANSISI_ILLEGAL → error 409 + event mission.invalid_transition (dicatat, bukan ditelan)
```

## 5. BACKEND STRUCTURE

```
src/lab/
  LabService.js          (facade)
  ProjectEngine.js       (CRUD + phase validator + rekomendasi fase via evidence)
  MissionEngine.js       (state machine + delegasi → orchestrator + progress kalkulasi)
  AgentStatusBoard.js    (state live dari event; TTL idle)
  InstrumentCatalog.js   (INSTRUMENTS: terminal/git/web/... → daftar tool via agentTools.tail)
  ArtifactRegistry.js
  DecisionLog.js
  ExperimentLab.js
  TestChamber.js
  ActivityLog.js
src/controllers/labController.js   (dirombak → tipis, delegasi ke LabService)
route /api/v1/console/lab/*        (kompatibel: /lab/projects v1 tetap)
```

Aturan routing fase (§5) di MissionEngine sebagai **tabel deterministik**, bukan prompt:
`RESEARCH → [vanta, mira]`, `IMPLEMENTATION → [forge, nexus]`, `TESTING → [forge+pulse]` … ditawarkan ke planner sebagai constraint.

## 6. UI STRUCTURE (rombak appHost Lab v1)

```
AETHER LAB (fullscreen layout — bukan app bertab kecil)
┌────────────┬──────────────────────────────────────────────┐
│ CONTEXT RAIL │  TOPBAR: project name · phase chip · Aether state │
│ (kiri, sempit)│──────────────────────────────────────────────│
│ Projects    │  MISSION CONTROL (aktif)                      │
│ Missions    │  ├ progress bar deterministik (dari tasks)    │
│ Agents      │  ├ agent board: ● forge WORKING (warna agent) │
│ Instruments │  └ waiting-state banner (WAITING_USER dsb)    │
│ Memory      │  AGENT WORKSPACE (detail agen terpilih §28)   │
│ Knowledge   │  LIVE ACTIVITY (stream lab_events, SSE)       │
│ Experiments │  TIMELINE (misi/keputusan/artefak/fase)       │
│ Artifacts   │                                                │
│ Decisions   │  COMMAND BAR bawah: tujuan bebas → misi baru  │
│ Tests       │                                                │
└────────────┴──────────────────────────────────────────────┘
```
- Bahasa visual: token kanonik `--ae-*` + neon layer yang sudah ada; grid teknis tipis, tipografi mono untuk id/data, indikator status tegas — tanpa kartu-kartu generik (§26).
- View lama `labProjects/labChat/labAgents` dicairkan jadi panel di dalam Lab baru (chat project = bagian Agent Workspace).

## 7. AGENT INTEGRATION MODEL

- `AgentHub` tetap sumber identitas; `agentTools.js` tetap resolver kapabilitas→tool (§10 sudah 90% jadi; tambah `InstrumentCatalog` sebagai penyajian konsep ke user).
- `AgentStatusBoard` mengubah event `agent.started/completed/failed` + heartbeat `agent:run` menjadi status hidup; UI Board + orb swarm (renderer `agentBus`) tinggal mapping.
- Delegasi misi: `MissionEngine.dispatch(task)` → pilih agent via (fase proyek + kapabilitas task + alias agentTools) → `agentHub.run()` → hasil → `lab_events` + artefak + progress.

## 8. MIGRATION STRATEGY (inkremental, reversibel)

1. **Migrasi DB** `005_lab.sql` (tabel baru saja; tidak menyentuh tabel lama).
2. `labController` v1 endpoint tetap kompatibel; LabService baru dipasang di belakangnya.
3. `lab.json` (v1) di-impor sekali ke `lab_projects` (konverter idempoten; file dipertahankan sebagai fallback).
4. UI: app `lab` diarahkan ke layout baru; view lama tidak dihapus sampai paritas fitur tercapai.
5. Event baru berprefix `lab:` — pipeline SSE/orb tidak berubah.

## 9. PHASED PLAN (map ke §39 spec)

| Fase (spec) | Isi | Estimasi file |
|---|---|---|
| P1 | ProjectEngine + MissionEngine + ActivityLog + ArtifactRegistry + UI Mission Control dasar | 005_lab.sql, LabService, 4 modul, labController, UI shell |
| P2 | AgentStatusBoard + InstrumentCatalog + Timeline UI | 2 modul + panel UI |
| P3 | Memory Lab (scope project) + Knowledge Lab + DecisionLog | integrasi MemoryEngine scope + 2 panel |
| P4 | ExperimentLab + TestChamber (+ state VERIFYING misi) | 2 modul + panel |
| P5 | Forge→OpenCode sesi per-misi persisten + Serena/Graphify hooks | MissionEngine kolom opencode_* + integrasi |
| P6 | Project Graph + Snapshot/Time Machine (data model) + observability lanjut | lab_snapshots + graph view |

## 10. TEST PLAN (§41 → 20 asersi)

`tests/lab/lab.test.js` + `scripts/smoke-lab.js`:
1–3 create/open project (+restart persist), 4–5 mission+assign agent, 6–7 profil tool benar & tidak bocor (assert `toolsForWorker` ⊂ registry, tak ada tool lintas-domain), 8–10 forge→opencode_run + sesi nyambung + repo berubah, 11–13 artefak+event+status transisi, 14 memori scope project, 15 project survive restart (baca ulang DB), 16 switch model (`reconfigure()` → misi utuh), 17 tool failure tercatat (`lab_events` + mission FAILED), 18 approval gate (aksi `risk=destructive` → WAITING_USER), 19 UI render sintaks, 20 chat lama 189/190 tetap.

---

## KEPUTUSAN YANG DIBUTUHKAN (sebelum implementasi)

1. **Persetujuan memulai P1** (dokumen ini = audit, belum ada kode Lab).
2. Konfirmasi: approval gate §32 hanya untuk aksi destruktif (memori tetap bebas — tidak mengembalikan governance memori).
3. Lab layout fullscreen menggantikan app-tab Lab v1 (v1 dipertahankan sampai paritas).
