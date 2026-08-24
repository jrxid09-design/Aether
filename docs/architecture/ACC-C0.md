# ACC C0 — Aether Cognitive Core (Discovery + Contract)

Status: **C0.0 delivered — implementation gates PENDING-GATE** (node execution
unavailable in the WSL session; gates run via `scripts/acc-gates.ps1`).

Baseline commit: `431c3b21d16246ab2770332789523b272c57e3cc` (branch
`feat/acc-c0`, created from `opensource` with all pre-existing work intact,
720 dirty entries preserved, nothing reset/cleaned).

## 1. Mission boundary

ACC C0 is a persistent, model-independent cognitive continuity layer.
It is NOT a persona, NOT a prompt, NOT a consciousness claim, NOT an
authority system. Two rules override everything:

- MODEL MAY INTERPRET THE SELF. MODEL MAY NOT DEFINE THE SELF.
- COGNITION NEVER GRANTS AUTHORITY.

## 2. Foundation map consumed by ACC (READ-ONLY)

| Surface | Location | ACC usage |
|---|---|---|
| Telemetry bus | `src/services/telemetryService.js` (`publish`, `.on("event")`, buffered `{id,time,type,payload}`) | sole production event intake via `integration/FoundationEventAdapter` |
| Tool reliability read-view | `src/ai/tools/ToolStats.js` (`reliability(name)`, `snapshot()`) | appraisal surprise weighting; never mutated |
| Canonical identity | `src/ai/runtime/requestIdentity.js`, `src/ai/tools/Authorization.js` (`identity`, `toCapabilitySet`, `disclosureFilter`, `assertExecution`) | internal cognitive requests use `capabilitySet=[]` frozen; behavioral proof reuses M-1 invariant |
| SQLite infra | `src/memory/db/*` (`Database` promise wrapper, file-based `migrate`) | additive migration `008_acc.sql`; ACC opens its own handle or shares when enabled |
| Runtime health hints | telemetry events (`tool:started/completed/failed`, `toolbus:exec`, `ai:fallback`, …) | OBSERVATION/SYSTEM_EVENT provenance only |

Dependency direction: ACC → foundation. No foundation module imports
`src/cognition/**` (enforced by `tests/cognition/accSecurityBoundary.test.js`).

## 3. Frozen foundation — change protocol

Frozen classes: Authorization, canonical request identity, RuntimeExecutor
security gates, ToolBus authorization gates, risk policy, SSRF/network trust,
Tool Intelligence authorization boundary, capabilitySet/delegation semantics.

If ACC appears to require changing any of these: STOP the change, record
`FOUNDATION_CHANGE_REQUIRED {file, reason, adapter alternative, consequence}`
in `docs/research/ACC-C0-report.md`, continue on independent work.

FOUNDATION_CHANGE_REQUIRED entries so far: **none**.

## 4. Phase plan and gate status

| Phase | Scope | Gate status |
|---|---|---|
| C0.0 | discovery + contract (this doc) | DELIVERED (no runtime behavior) |
| C0.1 | flag, ContinuityCore, journal/snapshot/replay, restart | PENDING-GATE |
| C0.2 | SelfModel, provenance, self/other/world, envelopes, contradiction | PENDING-GATE |
| C0.3 | appraisal, affect (multi-timescale decay), interoception | PENDING-GATE |
| C0.4 | global workspace salience/boundedness/habituation | PENDING-GATE |
| C0.5 | witness + metacognitive monitor (bounded enums) | PENDING-GATE |
| C0.6 | prediction lifecycle + Brier calibration; experience encoder | PENDING-GATE |
| C0.7 | substrate router; CognitiveRequest/Proposal; zero-capability calls | PENDING-GATE |
| C0.8 | lab: false-self, hidden-state, prompt variation, swap/restart/replay, ablations | PENDING-GATE |

Gate runner: `scripts/acc-gates.ps1` (Windows-native node). Results land in
`.tmp-closure/acc-gates.log` with machine-derived totals per phase.

## 5. Non-goals honored in C0

No Capability Lifecycle, no Colony, no embodiment, no self-granted permission,
no self-preservation drive, no autonomous model switching policy, no
consciousness/personhood claims, no hidden chain-of-thought persistence, no
per-event LLM calls (all C0 reducers are deterministic; LLM enters only as a
replaceable substrate producing validated `CognitiveProposal`).
