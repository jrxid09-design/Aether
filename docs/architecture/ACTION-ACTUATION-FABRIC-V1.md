# Action Actuation Fabric V1 (Lane 3 — first implementation)

Status: candidate (production-unwired; actuator wiring via trusted/test-only
harness)
Branch: `feat/action-authority-v1`
Foundation: `45bc318` (Wave 4 Lane 2 — certified closed), on `47827c9`
certified Lane 1.
Code: `src/action/actuation/**`, `tests/actuation/**`

## Purpose

Lane 2 answers:

```
what action is proposed?       (ActionIntent)
is it currently authorized?    (AuthorityDecision)
```

Lane 3 answers:

```
how is an authorized action dispatched to the correct actuator?
how do we preserve execution provenance and fail safely?
```

Lane 3 MUST NOT decide authority independently: fresh canonical Lane 2
revalidation happens INSIDE execute(), before any dispatch.

## Core laws

```
AVAILABLE != AUTHORIZED
AUTHORIZED != EXECUTED
EXECUTED != SUCCEEDED
SUCCEEDED != VERIFIED

PLAN != AUTHORITY
INTENT != AUTHORITY
CHANNEL != AUTHORITY
MODEL CLAIM != AUTHORITY
MEMORY != AUTHORITY

AUTHORITY DECISION IS HISTORICAL EVIDENCE,
NOT A BEARER EXECUTION TOKEN.
```

## Canonical bootstrap ownership

Lane 3 mirrors Lane 2's seventh-repair trust model exactly. There is no
public factory, no binder, no token, no first-call-wins surface anywhere:

```
TRUSTED BOOTSTRAP LAYER  (src/action/bootstrap.js)
        │
        │ owns (defined in its PRIVATE closure):
        ├── Lane 2 canonical facade (admit / evaluate / authenticate / session)
        ├── actuator registry + REGISTRAR CAPABILITY (bootstrap-owned;
        │     downstream NEVER receives it)
        └── canonical dispatcher (fresh-revalidating, exact-once guard,
              timeout/cancellation boundaries)
                │
                ▼
        frozen least-privilege actuation facade:
            Object.freeze({ execute })
```

`createCanonicalActuationFacade()` takes NO options (any option is rejected
with `CALLER_BOOTSTRAP_REJECTED`). The test-only harness
(`tests/actuation/harness.js`) mirrors this composition for controlled test
actuators; it lives under `tests/` and is NOT reachable from src/action.

Public actuation API (`src/action/actuation/index.js`) exposes ONLY:
`LIFECYCLE`, `RESULT_STATE`, `REASONS`, `TRANSITIONS`, `ExecutionError`,
`isCanonicalExecutionRequest`, `isCanonicalExecutionResult` — inert
vocabularies + pure brand predicates (closure-only WeakSets; clones/JSON/
forged symbols are never in the brand). NOT exported: every privileged
former/registry/dispatcher function and the brand tokens themselves.

## Actuator registry model

`buildActuatorRegistry()` (bootstrap-private) constructs a closure-owned
registry with a registrar capability that the trusted layer captures and
never hands downstream. Each binding identifies:

- `capabilityId` (canonical id)
- `operations` (supported operations, lowercased)
- `capabilityIncarnationId` (exact capability incarnation the binding was
  registered against)
- `actuatorId` (stable logical identity)
- `actuatorIncarnationId` (fresh lifetime identity per registration —
  binding A removed/recreated as B is a DIFFERENT lifetime; an ExecutionRequest
  bound to A never dispatches to B's semantics silently)
- `readiness` ("READY" | "UNAVAILABLE" | "DEGRADED")
- `invoke` — the invocation function, captured ONCE at trusted registration
  (function identity bind; post-registration mutation of caller-owned objects
  has zero semantic effect)

Atomic registration: a duplicate (capabilityId, operation) binding rolls the
whole registration back.

Downstream action requests may select capability, operation, parameters.
They may NOT select the executor function, actuator implementation, verifier,
or registry implementation — every caller-executor option
(`actuator`, `executor`, `invoke`, `fn`, `handler`, `impl`, ...) is rejected
with `CALLER_EXECUTOR_REJECTED` at call entry.

## ExecutionRequest schema

Immutable, deep-frozen, schemaVersion 1:

```
{
  schemaVersion: 1,
  executionId:                       UUID (minted at formation)
  intentId:                          canonical ActionIntent identity
  capabilityId:                      canonical capability id
  capabilityIncarnationId:           exact capability incarnation
  operation:                         declared operation
  principal:                         authenticated principal (post-revalidation)
  scope:                             canonical scope tokens (frozen, sorted)
  authorityGeneration:               Authority generation observed at revalidation
  admittedAtMs / requestedAtMs:      intent admission / request formation
  parameters:                        detached bounded payload snapshot
  metadata:                          detached bounded metadata (authority-shaped
                                     keys rejected recursively)
}
```

Bounds: payload ≤ 64KiB-ish node/key/string budgets; functions, symbols,
accessors, class instances, cycles, `__proto__`/`constructor`/`prototype`
rejected fail-closed. No hidden authority inside arbitrary metadata.

## Fresh revalidation path (the core invariant)

Immediately before dispatch, execute():

1. rejects caller-executor / bearer-decision options (fail-closed)
2. requires a canonical ActionIntent + authenticated session (shape + brand)
3. REVALIDATING: calls the canonical Lane 2 `evaluate(intent, session)`
   — the SAME canonical evaluation path certified in Lane 2 — fresh
4. non-ALLOW (revoked / stale generation / suspended / exhausted / foreign
   session / unavailable / undeclared) ⇒ FAILED + AUTHORITY_DENIED. NO EXECUTION.
5. re-checks capability incarnation against the fresh decision; mismatch ⇒
   FAILED + CAPABILITY_INCARNATION_MISMATCH
6. resolves the actuator binding and checks:
   - binding exists (ACTUATOR_NOT_FOUND)
   - binding capabilityIncarnationId == intent capabilityIncarnationId
     (ACTUATOR_INCARNATION_MISMATCH — actuator ABA)
   - readiness == READY (ACTUATOR_UNAVAILABLE)
7. READY ⇒ dispatch

There is NO path: old ALLOW → direct actuator(). A fake AuthorityDecision
passed by the caller is rejected outright (`CALLER_EXECUTOR_REJECTED`);
`expectedDecisionEvidence` is not implemented as a bypass — the fresh
canonical evaluation always decides.

## Exact-once / duplicate semantics

Deterministic content key (process-local): sha256 over
intent identity + capability incarnation + operation + session identity
(principal + sessionId) + canonical scope + parameter-hash + metadata-hash.

- duplicate IN-FLIGHT request → awaits the SAME promise (deterministic response)
- COMPLETED executionId replay (same content key) → returns the recorded
  result; NO second actuation
- conflicting payload (different parameters) → different content key →
  different execution (no false dedupe)

HONEST SCOPE: this is a PROCESS-LOCAL / RUNTIME-LOCAL exactly-once guard
(in-memory Map, completed results bounded at 4096 entries with FIFO eviction).
It is NOT a distributed exactly-once guarantee. That is the actual guarantee.

## Lifecycle model

```
CREATED → REVALIDATING → READY → DISPATCHING → EXECUTED | FAILED | TIMED_OUT
                ↘ FAILED              ↘ CANCELLED (pre-dispatch only)
```

- Illegal transitions throw (`MALFORMED_REQUEST`) — the state machine is
  fail-closed, driven by a frozen transition table.
- There is deliberately NO VERIFIED state (Lane 4 owns verification).
- EXECUTED means the actuator invocation completed per Lane 3 semantics —
  NOT that the real-world effect was verified.

## Timeout / cancellation semantics

- Timeout (default 30s, per-execution override in [1ms, 5min]) → TIMED_OUT;
  NO silent retry; the actuator's uncancelable side-effect ambiguity is
  preserved. **timeout != proof of no side effect** (documented in the result
  and in this doc).
- Cancellation via AbortSignal: pre-dispatch abort → CANCELLED with ZERO
  invocations guaranteed. Abort AFTER invocation started → CANCELLATION_TOO_LATE
  semantics: the execution continues to its real outcome and is recorded
  honestly (never falsely "prevented").

## Result / evidence model

Structured result (deep-frozen, schemaVersion 1): executionId, intentId,
capabilityId, capabilityIncarnationId, operation, principal, actuatorId,
actuatorIncarnationId, state, startedAtMs, completedAtMs, actuatorReport
(sanitized), failureReason/failureDetail, authorityGeneration used,
lifecycleTrace, and the explicit non-claims `verified: null` +
`verificationClaim: null`.

Audit evidence (`buildExecutionEvidence`, dispatcher-private): kind, who
(principal), what (capability/operation/scope), which lifetimes (capability +
actuator incarnations), why authorized (authority generation observed at
revalidation + revalidatedAtMs), when (started/completed), outcome/lifecycle.
The Audit Ledger is NOT the source of current truth.

Actuator output sanitization: Errors → { name, message } (no stack);
functions/symbols/undefined/bigints → null; class instances/Maps/Sets → null;
accessors skipped; depth/node/string bounds enforced. Hostile thrown objects
never escape canonical boundaries.

## Security regression tests

`tests/actuation/security.test.js` (22 tests): all 18 required proofs plus
4 structural tests (no privileged factory on any public surface; brand
predicates unforgeable against clone/JSON/forged; lifecycle state machine
integrity; public-API-only factory scan).

`tests/actuation/storm.test.js` (2 tests): ≥12,000 deterministic mixed
operations ×2 seeds + divergent seed; all 15 violation counters zero with
ACTIVE detection paths:

```
staleAuthorityExecuted, staleCapabilityIncarnationExecuted,
staleActuatorIncarnationExecuted, fakeActuatorExecuted,
foreignSessionExecuted, unavailableCapabilityExecuted,
undeclaredOperationExecuted, duplicateExecution,
conflictingReplayExecuted, timeoutRetriedActuation,
callerMutationChangedActuator, decisionUsedAsBearerAuthority,
authorityMutationDuringExecution, capabilityMutationDuringExecution,
verificationClaimedByLane3
```

## Test results

- Lane 3 targeted: 24 tests (22 security + 2 storm), 0 failures
- Lane 2 regression: 89 tests, 0 failures
- Lane 1 capability + canonical Authority: 186 tests, 171 pass, 15 fail —
  the 15 are the documented pre-existing `sqlite3` native-module environment
  nonblockers, IDENTICAL to the Lane 2 baseline (verified via stash); zero
  regressions, no unrelated dependencies touched.

## Known nonblockers

- Production actuator wiring: the canonical registrar capability is owned by
  the bootstrap closure; a later lane wires real actuators through trusted
  composition (Lane 3 ships the fabric + the test-only harness).
- Exactly-once is process-local (documented above), not distributed.
- OWNER_CONFIRMATION_REQUIRED remains semantic-only (Lane 2 nonblocker).
- sqlite3-native authority tests: environment-only failures (see above).
- Lane 4 (verification/compensation) intentionally NOT implemented: results
  carry `verified: null` and no VERIFIED lifecycle state exists.
