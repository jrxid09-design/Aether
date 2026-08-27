# CAPABILITY REGISTRY / CAPABILITY GRAPH V1

Status: candidate (additive, production-unwired)
Branch: `feat/capability-graph-v1`
Base: `f5f468e`
Code: `src/capability/registry/**`, `tests/capability/**`

## Purpose

Aether needs a canonical, descriptive answer to four questions:

```
What capabilities exist or may exist in this runtime?
Where do they come from?
What do they depend on?
Are they currently available?
```

This lane builds the **Capability Registry / Capability Graph V1** — the single
canonical owner of capability *descriptions*, *provenance*, *dependency
relationships*, and *runtime availability observations*.

It deliberately does NOT answer:

```
Is the caller authorized?   (Authority's job)
Should Aether execute it?    (later Wave-4 lanes)
How is it executed?          (later Wave-4 lanes)
Did execution succeed?       (later Wave-4 lanes)
```

## Core law (enforced structurally)

```
CAPABILITY AVAILABILITY != AUTHORITY
```

A registered, discovered, installed, healthy, online, trusted, or available
capability MUST NOT imply permission. The registry is **descriptive**;
Authority remains **normative**. The registry never grants, ratifies,
delegates, approves, authorizes, mints Authority capability, executes,
invokes, dispatches, or actuates.

## Canonical ownership

| Domain           | Owns                                                        |
|------------------|-------------------------------------------------------------|
| Authority        | grants / ratification / delegation                          |
| Extension Kernel | extension registration / discovery lifecycle                |
| Device Identity  | device identity / pairing / trust evidence                  |
| Runtime Host     | host lifecycle / human transport orchestration              |
| Governor         | resource / admission decisions                              |
| **Capability Registry** | canonical descriptions, provenance, dependencies, availability observations |

The Capability Registry is NOT a second Authority system.

## Existing capability-code inventory (ownership decision)

- `src/capability/` (legacy) — a trivial loader/registry/validator: reads JSON
  from disk with `fs`, registers into a bare `Map` (last-writer-wins), has no
  provenance, no bounds, no immutability, no dependency graph, and no typed
  error contract. **Not a usable canonical base.** Left untouched.
- `src/extensions/` (Wave 3 CERTIFIED) — has inert capability *advertisement*
  and a capability-name grammar, but its registry owns *extension lifecycle*,
  not a capability graph.
- `src/authority/canonical.js` — normative Authority capability-id grammar.
  **Not imported** (Authority isolation).
- `src/embodiment/identity` — device identity with `observedCapabilities`
  (observation-only vocabulary).

**Decision:** build a new isolated module `src/capability/registry/` (canonical
V1) alongside the legacy `src/capability/`. It reuses the *conventions* of the
certified Extension Kernel (error contract, closed schema, deep-freeze,
structured clone, atomic validate-then-mutate, deterministic ordering) without
depending on it, and imports no Authority/Governor/tool/process code.

## Descriptor schema (closed, schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,
  "id": "filesystem.read",          // canonical, bounded, deterministic
  "kind": "system",                 // tool|extension|device|runtime|provider|system
  "provider": "core",
  "source": "core/runtime",         // informational provenance mirror
  "operations": ["read"],           // inert operation-name strings
  "requirements": [],
  "effects": [],
  "availability": "UNKNOWN",        // UNKNOWN|AVAILABLE|UNAVAILABLE|DEGRADED
  "provenance": "core/runtime",     // canonical provenance
  "dependencies": ["device.camera.present"],
  "metadata": {},
  "description": ""
}
```

- Unknown fields are **rejected** (fail-closed, schema-versioned).
- Authority-shaped fields (`authorized`, `approved`, `owner`, `root`,
  `trusted`, `granted`, `ratified`, `delegated`, `elevated`, `permitted`,
  `authority`, `isAuthority`, `canAuthorize`) are not part of the schema and
  are rejected with a clear reason.
- Capability IDs follow the same lowercase dotted grammar as the certified
  Extension Kernel / Authority (`[a-z0-9]([a-z0-9._-]*[a-z0-9])?`, 3..256
  chars), case-folded, whitespace/path/reserved-segment rejected.

## Capability kinds (bounded)

`tool`, `extension`, `device`, `runtime`, `provider`, `system`.
Unknown kinds fail closed. No speculative dozens.

## Provenance

Canonical provenance strings:

```
core/runtime   |   system   |   tool:<id>   |   extension:<id>
device:<id>    |   provider:<id>
```

`authority`, `owner`, and `root` are **rejected** as caller-supplied
provenance (self-asserted privilege scope). Provenance is evidence only.

## Availability model (separate from authorization)

`UNKNOWN` (default) → `AVAILABLE` | `UNAVAILABLE` | `DEGRADED`.

Deliberately absent: `AUTHORIZED`, `APPROVED`, `TRUSTED`. Availability
observations are **generation-aware**: a stale (older-generation) observation
is rejected and can never overwrite a newer one. `STALE_OBSERVATION` is a
typed error.

## Dependency graph semantics

Dependencies are **inert graph data**. Inspecting or resolving them never
executes anything. Operations:

- register / remove (where allowed) / get by id / list / list by
  source·provider·kind / dependency lookup / reverse dependency lookup /
  availability observe / resolve dependency status.

Missing dependencies are **permitted at registration** (a capability may
describe a dependency on something not yet registered) and are surfaced by
`resolveDependencyStatus`, not rejected.

## Cycle policy (V1): REJECT

Self (`A->A`), two-node (`A->B->A`), and multi-node (`A->B->C->A`) cycles are
rejected deterministically BEFORE any mutation (no partial state). Cycle
detection is bounded by an explicit edge/node/traversal budget.

## Duplicate policy

- same id + **different provenance** → typed `DUPLICATE_CONFLICT`.
- same id + same provenance + **identical descriptor** → deterministic
  idempotent no-op (`{registered:false, idempotent:true}`).
- same id + same provenance + **materially different descriptor** →
  `DUPLICATE_CONFLICT`.

No last-writer-wins privilege confusion.

## Generation policy

Availability observations carry an integer `generation`. A stale (lower)
generation is rejected with `STALE_OBSERVATION`; equal-generation identical
state is an idempotent no-op; equal-or-higher generation with a different
state mutates. Historical availability is never conflated with current
availability.

## Typed error matrix

`CapabilityRegistryError` with stable `reasonCode`:

| reasonCode               | class of failure                          |
|--------------------------|--------------------------------------------|
| `MALFORMED_INPUT`        | invalid descriptor field type/shape        |
| `MALFORMED_JSON`         | non-JSON string/Buffer input               |
| `UNKNOWN_FIELD`          | closed-schema violation / authority field  |
| `DANGEROUS_KEY`          | `__proto__`/`constructor`/`prototype`      |
| `UNSUPPORTED_SCHEMA`     | schemaVersion mismatch                     |
| `NON_PLAIN_OBJECT`       | class instance/Date/Map/Set                |
| `CYCLIC_INPUT`           | cyclic structure                           |
| `FUNCTION_VALUE`         | function payload                           |
| `SYMBOL_VALUE`           | symbol key/value                           |
| `ACCESSOR_PROPERTY`      | getter/setter                              |
| `UNBOUNDED_STRING`       | metadata string over bound                 |
| `BOUND_EXCEEDED`         | any explicit bound                         |
| `INVALID_CAPABILITY_ID`  | bad/oversized id                           |
| `INVALID_PROVENANCE`     | bad provenance                             |
| `INVALID_PROVENANCE_SCOPE` | authority/owner/root provenance          |
| `UNKNOWN_KIND`           | kind not in vocabulary                     |
| `DUPLICATE_CONFLICT`     | duplicate id conflict                      |
| `UNKNOWN_CAPABILITY`     | id not registered                          |
| `REGISTRY_FULL`          | registry size bound                        |
| `INVALID_DEPENDENCY`     | removal blocked by dependents              |
| `DEPENDENCY_CYCLE`       | cycle at registration                      |
| `GRAPH_TRAVERSAL_BOUND`  | graph traversal budget                     |
| `INVALID_AVAILABILITY`   | bad availability state                     |
| `STALE_OBSERVATION`      | stale generation                           |

## Authority isolation proof

`tests/capability/security.test.js` proves structurally that no file under
`src/capability/registry/` requires `src/authority`, Resource Governor, or any
process/network/fs mutation module. `tests/capability/graph.test.js` (test 36)
proves the real `src/authority/store` surface is byte-identical before/after
registry operations.

## Governor isolation proof

`tests/capability/graph.test.js` (test 37) proves the real
`src/runtime/resourceGovernor` surface is byte-identical before/after registry
operations. The registry never alters Governor state.

## Zero-execution structural proof

`tests/capability/security.test.js` proves the public surface contains no
execution verbs (`execute/invoke/run/dispatch/actuate/spawn/shell/callTool/
performAction`) and no authority verbs (`grant/authorize/approve/ratify/
delegate/elevate/trustAsAuthority`). A descriptor literally named
`shell.execute` remains inert descriptive data.

## Immutability

Caller input is read exactly once (via `Object.getOwnPropertyDescriptor(...)
.value`, which never invokes getters) into a detached canonical clone. The
hostile original is never retained. Returned descriptors are deep-frozen
detached clones. Functions, accessors, symbols, non-plain objects, and cycles
are rejected. Caller mutation after register, and returned-object mutation,
cannot touch canonical state.

## Bounds

| Bound                       | Value   |
|-----------------------------|---------|
| descriptor bytes            | 64 KiB  |
| capability id length        | 256     |
| provenance length           | 256     |
| operations / requirements / effects / dependencies | 64 each |
| operation/requirement/effect string | 256 |
| description                 | 512     |
| metadata depth              | 8       |
| metadata global node budget | 512 (shared across the whole walk) |
| metadata key / string       | 128 / 256 |
| registry size               | 1024    |
| graph edges / nodes / traversal | 8192 / 8192 / 65536 |

Nested metadata traversal uses a single global node budget (no per-branch
reset), preventing OOM-shaped DAG amplification.

## Atomicity

Registration/removal validate FIRST and mutate SECOND. A rejected operation
leaves canonical state byte-identical: no partial indexes, no reverse-edge
residue. Tested for bad descriptors, duplicate conflicts, bad dependencies,
cycles, bounds, hostile accessors, hostile Proxies, and stale generations.

## Structural indexes

`byId`, `byKind`, `byProvenance`, `_edges` (dependency), `_reverseEdges`
(reverse dependency) are maintained atomically and never exposed as mutable
internal Maps/Sets. Consistency is asserted in the storm test.

## Persistence decision

V1 keeps all state in memory. `serialize()` produces a deterministic, frozen
snapshot of canonical state (no live objects) — the persistence port shape for
a future store. Serialization contains zero executable behavior.

## Hostile storm

`tests/capability/storm.test.js` runs **>=12000 deterministic mixed
operations** across core/extension/device/provider/tool sources, mixing
register/duplicate/remove/lookup/list/traversal/availability/stale/cycle/
oversized/getter/Proxy/DAG/unknown-field/forged-authority. It tracks and
requires-zero: `authorityMutations`, `governorMutations`, `executions`,
`actuations`, `getterInvocations`, `callablesRetained`,
`staleGenerationMutations`, `partialStateMutations`, `indexDivergence`,
`unexpectedUntypedErrors`, `openHandleLeaks`. Registry size and graph
traversal remain bounded. Run twice with the same seed → identical digest.

## Known nonblocking observations

- Legacy `src/capability/` remains untouched; migration is future work by
  design (Wave 4 integration decides canonical wiring later).
- `serialize()` intentionally excludes an authority/audit history; Capability
  Registry state is not Audit Ledger state (history != current state).
- This lane implements no device/extension actuation; integration boundaries
  that derive descriptors from certified Extension Kernel manifests and
  Device Identity observations are future additive work.
