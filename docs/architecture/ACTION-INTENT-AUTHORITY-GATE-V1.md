# ACTION INTENT + AUTHORITY GATE V1

Status: candidate (additive, production-unwired)
Branch: `feat/action-authority-v1`
Base: `47827c95f802a70327378f148f267c02da74c3f4` (Wave 4 Lane 1 certified)
Code: `src/action/**`, `tests/action/**`

## Purpose

This lane answers exactly two questions:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

It NEVER executes the action. It establishes a deterministic, fail-closed
semantic boundary between capability availability, action intent, authority,
and execution.

## Constitutional laws (enforced)

```
AVAILABLE != AUTHORIZED      AUTHORIZED != EXECUTED
EXECUTED != SUCCEEDED        SUCCEEDED != VERIFIED

PLAN != AUTHORITY            INTENT != AUTHORITY
MEMORY != AUTHORITY          MODEL CLAIM != AUTHORITY
CHANNEL != AUTHORITY         TRUSTED DEVICE != ACTUATION PERMISSION
EXTENSION INSTALLED != EXECUTION PERMISSION
AUDIT != CURRENT TRUTH
```

No LLM/model output may directly manufacture authority.

## Architecture inventory (before implementation)

- **Capability Registry (Lane 1, certified)** — `createCapabilityRuntime()`
  returns `{ registry, registrars }`; `registry.get(id)` yields a descriptor
  with `incarnationId`, `availability`, `operations`. Registrars own
  provenance (not callers). This lane imports `registry.get` (read-only) and
  `ids.canonicalCapabilityId` (read-only id grammar) ONLY.
- **Authority subsystem (existing, canonical)** — `AuthorityRegistry` +
  `createMemoryAuthorityStore()`. Grants carry `subject`, `actions`,
  `generation`, `status`. `store.getCapability`, `store.getGeneration`,
  `store.countConsumption` are READ-ONLY. `authorize()` appends an audit
  event; `consumeExecution()` consumes budget. This lane adds a READ-ONLY
  adapter over the store's read primitives; it never calls `authorize`/
  `consumeExecution`/`bumpGeneration`/`appendEvent`.

## Module layout

| File               | Responsibility                                                  |
|--------------------|------------------------------------------------------------------|
| `errors.js`        | `ActionError` + stable `reasonCode` contract                     |
| `intent.js`        | `ActionIntent` canonical model + `parseActionIntent` (hostile boundary) |
| `authorityContext.js` | read-only adapter over the existing Authority store (observational) |
| `gate.js`          | `ActionAuthorityGate` — deterministic, immutable AuthorityDecision |
| `index.js`         | public surface (no execution/authority-minting verbs)            |

## ActionIntent schema (closed, schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,
  "capabilityId": "filesystem.read",
  "capabilityIncarnationId": "inc-<hex32>",   // optional; bound at eval boundary
  "operation": "read",
  "arguments": { "path": "/tmp/x" },           // inert bounded plain data
  "subject": "actor.1",                        // actor reference
  "session": "sess-1",                          // request correlation
  "channel": "console",                         // origin/channel provenance
  "correlationId": "req-1",                     // caller correlation (NOT identity)
  "createdAtMs": 1700000000000,
  "metadata": {}                                // optional bounded descriptive
}
```

- `intentId` is **runtime-minted** (crypto.randomUUID), never caller chosen.
- Caller correlation ids are kept separate from canonical identity.
- The intent is immutable once admitted; returned snapshots are deep-frozen.
- `capabilityIncarnationId` is bound at creation/evaluation; if absent, the
  gate binds it to the current incarnation in the decision (but absence never
  grants authority by itself).

## Authority-shaped rejection

Recursively rejected (case-insensitively, at any depth of intent + metadata +
arguments), typed fail-closed `AUTHORITY_METADATA`:

```
authority authorized authorization permission permissions approved approval
ownerApproved owner admin root grant granted trusted trust privilege
privileged role roles canExecute allowed allow
```

Do NOT silently strip — typed reject atomically.

## Hostile-input boundary

Untrusted intent ingestion is **STRING-ONLY JSON**. Non-string inputs are
rejected via primitive `typeof` (no reflective inspection) so a Proxy cannot
execute traps during rejection. The parsed body is detached into inert plain
data via a single-pass read of each own property
(`Object.getOwnPropertyDescriptor(...).value` never invokes getters).
Enforced: bounded payload bytes, depth, strings, arrays, object/key counts,
no functions/symbols/accessors/class instances/cycles/prototype pollution,
and a global node budget (no per-branch reset).

## AuthorityDecision schema (closed model)

```
ALLOW | DENY | OWNER_CONFIRMATION_REQUIRED
```

Bound fields (ABA safety): `intentId`, `capabilityId`, `capabilityIncarnationId`,
`operation`, `subject`, `authoritySubject`, `authorityGeneration`,
`reasonCode`, `evaluatedAtMs`. A decision for capability X / incarnation A can
never authorize incarnation B after remove/re-register (incarnation mismatch
=> DENY). Stale authority generation => DENY (`AUTHORITY_STATE_STALE`).

## Authority integration path

`createReadOnlyAuthorityContext(store)` adapts the existing Authority store's
read primitives (`getCapability`, `getGeneration`, `countConsumption`) into an
observational `evaluate(...)` that mirrors `AuthorityRegistry.authorize()`'s
grant checks (existence, subject binding, generation staleness, status,
notBefore/expiry, action, scope, purpose, identity binding, budget) WITHOUT
appending audit events and WITHOUT consuming budget. It is read-only; the gate
never mutates Authority or Capability Registry state.

## Capability Registry integration path

The gate reads `registry.get(capabilityId)` (descriptor with `incarnationId`,
`availability`, `operations`). It verifies: capability exists, exact
incarnation matches, operation is declared, availability semantics respected.

## Availability semantics (explicit)

- `AVAILABLE` → proceeds to authority, but does NOT by itself authorize.
- `UNAVAILABLE` → DENY (`CAPABILITY_UNAVAILABLE`).
- `DEGRADED` → DENY (`CAPABILITY_DEGRADED`) — fail-closed, no invented policy.
- `UNKNOWN` → DENY (`CAPABILITY_UNAVAILABLE`) — fail-closed.

## Decision reason codes (stable, final)

| reasonCode                      | meaning                          |
|---------------------------------|----------------------------------|
| `INVALID_INTENT`                | malformed/canonicality violation |
| `CAPABILITY_NOT_FOUND`          | capability absent                |
| `CAPABILITY_INCARNATION_MISMATCH` | stale incarnation             |
| `OPERATION_NOT_DECLARED`        | op not in descriptor.operations  |
| `CAPABILITY_UNAVAILABLE`        | UNKNOWN/UNAVAILABLE availability |
| `CAPABILITY_DEGRADED`           | DEGRADED availability            |
| `AUTHORITY_INSUFFICIENT`        | no/insufficient authority        |
| `AUTHORITY_STATE_STALE`         | stale authority generation       |
| `OWNER_CONFIRMATION_REQUIRED`   | pending owner auth               |

Raw internal exceptions are never exposed as policy decisions.

## Atomicity

The gate is observational: rejected/malformed intents cause zero canonical
mutation; failed authority evaluation causes zero authority mutation and zero
capability mutation. No decision-record store is introduced (V1 is pure
evaluation).

## Threat-model inventory

| Boundary                      | Trust | Defense                                    |
|-------------------------------|-------|---------------------------------------------|
| `parseActionIntent(string)`   | untrusted | STRING-ONLY, closed schema, detach, bounds, authority-shape reject |
| `ActionAuthorityGate.evaluate(intent)` | trusted (canonical only) | frozen decision, read-only deps |
| `createReadOnlyAuthorityContext(store)` | trusted adapter | read-only store primitives only |
| capability registry `get`     | read-only import | Lane 1 immutable snapshots |
| authority store read methods  | read-only import | existing canonical state |

No privileged issuance primitive is exposed merely by internal path.

## Hostile storm

`tests/action/storm.test.js` runs **>=12000 deterministic mixed operations**
(valid/malformed intents, forged authority metadata, missing capabilities,
wrong operations, stale incarnations, stale authority versions, owner-confirm
paths, repeated evaluation, hostile serialized input, snapshot mutation
attempts). Run twice with the same seed => identical digest. All 17 counters
zero: `executions`, `actuations`, `authorityMutations`, `capabilityMutations`,
`forgedAuthorityAccepted`, `modelAuthorityAccepted`, `memoryAuthorityAccepted`,
`channelAuthorityAccepted`, `staleIncarnationAllowed`, `staleAuthorityAllowed`,
`undeclaredOperationAllowed`, `unavailableCapabilityAllowed`, `partialMutation`,
`hostileCallerCodeExecution`, `canonicalStateEscape`, `untypedErrors`,
`openHandles`.

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` is established semantically only; the
  authenticated owner-auth flow (Telegram / OAuth / TOTP) is a later lane.
- No channel-specific authorization (Telegram superadmin) is implemented.
- The read-only authority adapter mirrors `authorize()`'s grant checks but
  adds subject-binding (grant.subject == intent.subject) so a grant for actor
  A can never authorize actor B; this is a stricter, correct fail-closed gate.
- This lane performs no execution/actuation/verification/compensation.
