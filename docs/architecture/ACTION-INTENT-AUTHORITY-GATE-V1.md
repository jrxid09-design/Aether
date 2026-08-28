# ACTION INTENT + AUTHORITY GATE V1 (repaired)

Status: candidate (post-repair, production-unwired)
Branch: `feat/action-authority-v1`
Base: `53c103b` (Wave 4 Lane 2 pre-cert candidate), on `47827c9` certified Lane 1
Code: `src/action/**`, `src/authority/evaluate.js`, `tests/action/**`

## Purpose

Answers exactly two questions, without executing anything:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

## Repaired trust model (post-Codex-pre-cert)

```
UNTRUSTED serialized proposal
        -> trusted capability resolution (registry)
        -> canonical scope binding (trusted scopeResolver)
        -> immutable ActionIntent (incarnation-bound)
        -> trusted RuntimeIdentityContext
        -> canonical Authority read-only evaluator (SHARED)
        -> fully-bound AuthorityEvaluation
        -> immutable AuthorityDecision
```

## Blocker resolutions

### B1 — identity separation
ActionIntent has NO `subject`/`session`/`channel` field. Authority identity
comes exclusively from a trusted `RuntimeIdentityContext` (`principal` /
`sessionId` / `channel`) built by runtime auth infrastructure. A caller-supplied
`subject`/`channel`/`session`/`scope` field is rejected as authority-shaped at
the parse boundary.

### B2 — scope binding
Canonical scope is produced by a TRUSTED `scopeResolver(capabilityId,
operation, arguments)` at admission and baked into the immutable intent. The
raw intent has no `scope` field (rejected). A scoped grant with an empty
(unresolved) request scope fails closed (`CAP_SCOPE_MISMATCH`).

### B3 — single canonical evaluator
`src/authority/evaluate.js` exports `evaluateAuthorityReadOnly`, the SINGLE
source of truth for grant validation (subject/generation/status/notBefore/
expiry/action/scope/purpose/identity-binding/budget). Both
`AuthorityRegistry.authorize()` and Lane 2's `createReadOnlyAuthorityContext`
delegate to it. Store read failures, malformed persisted grants, and unknown
budget results FAIL CLOSED (never `used = 0`, never a positive).

### B4 — lifetime binding
`createIntentAdmission` binds `capabilityIncarnationId` at ADMISSION (never at
gate evaluation). A missing capability or undeclared operation fails closed at
admission. The gate requires the intent's incarnation to equal the registry's
current incarnation (mismatch => DENY).

### B5 — full evaluation validation
The gate only emits ALLOW from a fully-validated `AuthorityEvaluation` snapshot
(`allowed===true`, nonnegative safe-integer `generation`, exact `capabilityId`,
non-empty `subject`, exact `principal`, exact `action`, exact `scope`, non-empty
`reasonCode`). Any missing/mismatched/malformed field => `MALFORMED_AUTHORITY_EVALUATION` => DENY.

### B6 — hardened clock
`captureClock` mirrors Lane 1: read `nowMs` once, capture function identity,
never re-read the caller clock, validate every timestamp (number/finite/
nonnegative/safe-integer). Applied to intent admission, gate evaluation, and the
read-only authority evaluator.

## Decision model (unchanged)

`ALLOW | DENY | OWNER_CONFIRMATION_REQUIRED`, bound to `intentId`,
`capabilityId`, `capabilityIncarnationId`, `operation`, `principal`,
`authorityGeneration`, `reasonCode`, `evaluatedAtMs`.

## Reason codes

`INVALID_INTENT`, `INVALID_IDENTITY`, `CAPABILITY_NOT_FOUND`,
`CAPABILITY_INCARNATION_MISMATCH`, `OPERATION_NOT_DECLARED`,
`CAPABILITY_UNAVAILABLE`, `CAPABILITY_DEGRADED`, `AUTHORITY_INSUFFICIENT`,
`AUTHORITY_STATE_STALE`, `OWNER_CONFIRMATION_REQUIRED`,
`MALFORMED_AUTHORITY_EVALUATION`.

## Module layout

| File | Responsibility |
|------|----------------|
| `src/authority/evaluate.js` | canonical read-only evaluator (shared) |
| `src/action/errors.js` | `ActionError` + reason codes |
| `src/action/clock.js` | hardened clock capture |
| `src/action/intent.js` | `parseActionIntent` (untrusted boundary) + `canonicalScope` |
| `src/action/admission.js` | `createIntentAdmission` (incarnation+scope binding) |
| `src/action/runtimeIdentity.js` | trusted `RuntimeIdentityContext` |
| `src/action/authorityContext.js` | thin adapter over the shared evaluator |
| `src/action/gate.js` | `ActionAuthorityGate` (decision) |
| `src/action/index.js` | public surface |

## Preserved invariants

STRING-only hostile boundary, zero Proxy execution, recursive authority-shaped
rejection, intent immutability, decision immutability, no execution, no
actuation, no Authority mutation, no Capability mutation, no channel-specific
auth, no Telegram superadmin.

## Tests

`tests/action/`:
- `blockerIdentity.test.js` — B1 identity/channel/session spoof + B2 scope + B3
  store-failure + B4 incarnation A->B.
- `blockerEval.test.js` — B5 malformed-evaluation matrix + B6 clock matrix.
- `adversarial.test.js` — hostile boundary + prototype pollution + model/LLM.
- `differential.test.js` — >=1200 canonical-vs-gate cases, `lane2AllowCanonicalDeny==0`.
- `security.test.js` — structural import audit + no execution/authority verbs.
- `storm.test.js` — >=12000 ops, 25 counters zero.

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` is semantic only (owner-auth flow is a later lane).
- `sqlite3` native module absent in this environment (non-differential env failures).
- The shared evaluator adds empty-scope-fail-closed and principal-binding to the
  canonical semantics; existing memory-based Authority tests remain green.
