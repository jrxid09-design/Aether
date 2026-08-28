# ACTION INTENT + AUTHORITY GATE V1 (sealed runtime composition)

Status: candidate (post third repair, production-unwired)
Branch: `feat/action-authority-v1`
Base: `547c207` (Lane 2 pre-cert), on `47827c9` certified Lane 1
Code: `src/action/**`, `src/authority/evaluate.js`, `tests/action/**`

## Purpose

Answers exactly two questions, without executing anything:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

## Sealed trust model

```
Trusted Aether bootstrap
        -> canonical CapabilityRuntime
        -> canonical AuthorityStore
        -> authenticated Session issuer (createAuthSessionIssuer)
        -> trusted ScopeBindings (captured ONCE, detached)
        -> createActionAuthorityRuntime ONCE
        -> returns least-privilege surfaces:
             admit(serializedProposal)       (identity-free canonical intent)
             evaluate(intent, authSession)   (AuthorityDecision)
```

CORE LAW: `VALID SHAPE != TRUSTED ORIGIN`.

## Blocker resolutions

### B1 — identity issuance bound to authenticated session
`issueIdentity({principal})` is REMOVED. Identity comes exclusively from a
BRANDED `AuthSessionCapability` minted by trusted authentication infrastructure
(`createAuthSessionIssuer`, held by bootstrap, never injected downstream). The
runtime derives `RuntimeIdentity` internally from the passed session. The
runtime exposes no identity-minting surface (`issueIdentity` / `mintSession` /
`issueSession` are absent). An arbitrary caller cannot mint a "victim" identity
and cannot bind a new runtime to canonical state to gain privileged issuance.

### B2 — sealed gate (no mutable internals)
The gate is a CLOSURE-BOUND, frozen `{ evaluate }`. It closes over the canonical
evaluator, canonical brand verifier, capability registry, and hardened clock.
There are no `_evaluate` / `_isCanonical` / `_registry` / `_clock` /
`_authorityContext` properties, no mutable callbacks, and no exported raw gate
constructor. Reassignment/`defineProperty`/prototype tampering are impossible
(frozen).

### B3 — detached scope bindings
At construction, resolver FUNCTION IDENTITIES are captured exactly once into an
internal closure-owned `Map(capabilityId -> Map(operation -> fn))`. The caller's
`trustedScopeBindings` object is never re-read. Outer/nested/delete mutation
after composition has zero effect.

### B4 — brand-first identity rejection
`isAuthSession` and `isCanonicalAuthorityEvaluation` check the brand (WeakSet
membership) BEFORE inspecting any fields. A hostile Proxy cannot execute
get/getPrototypeOf/ownKeys/getOwnPropertyDescriptor/has/set traps during
rejection of an unbranded value.

## Group B (preserved from prior repair)

`loadAndEvaluateAuthority(store, request, opts)` remains the SINGLE canonical
evaluator (full grant rehydration + validation + subject/principal binding +
branded evaluation). `AuthorityRegistry.authorize()` and the Lane 2 gate both
delegate to it.

## Public API

Exports: `createActionAuthorityRuntime` (trust issuance surface),
`createAuthSessionIssuer` (bootstrap-only auth infra), `parseActionIntent`
(untrusted ingress), inert constants, and read-only verifiers (`isAuthSession`,
`isCanonicalAuthorityEvaluation`).

NOT exported: `mintAuthSession`, `createGate`, raw identity minting, raw
evaluator, raw brand minting, mutable resolver lookup, injectable gate internals.

## Preserved invariants

STRING-only hostile boundary, zero Proxy execution, recursive authority-shaped
rejection, intent/decision immutability, no execution, no actuation, no
Authority/Capability mutation, no channel-specific auth, hardened clock capture,
incarnation binding, shared canonical evaluator, 2200-case differential.

## Tests

`tests/action/`: `blockerIdentity.test.js`, `blockerEval.test.js`,
`trustOrigin.test.js`, `adversarial.test.js`, `security.test.js`,
`differential.test.js` (>=2000 cases), `storm.test.js` (>=12000 ops, 40 counters
zero).

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` semantic only (owner-auth flow later lane).
- `sqlite3` native module absent (non-differential env failures).
- Brand tokens + closure are same-process boundaries (documented honestly, not
  OS isolation).
