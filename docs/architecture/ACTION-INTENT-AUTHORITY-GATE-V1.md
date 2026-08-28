# ACTION INTENT + AUTHORITY GATE V1 (trust-origin repaired)

Status: candidate (post second repair, production-unwired)
Branch: `feat/action-authority-v1`
Base: `de6d63f` (Lane 2 pre-cert), on `47827c9` certified Lane 1
Code: `src/action/**`, `src/authority/evaluate.js`, `tests/action/**`

## Purpose

Answers exactly two questions, without executing anything:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

## Trust model (post trust-origin repair)

```
UNTRUSTED serialized proposal
        -> trusted capability resolution (registry)
        -> trusted capability-bound scope resolver (closed mapping)
        -> immutable ActionIntent (incarnation-bound)
        -> BRANDED trusted RuntimeIdentityContext
        -> canonical Authority evaluator (SHARED, full rehydration)
        -> BRANDED immutable AuthorityEvaluation
        -> immutable AuthorityDecision
```

CORE LAW: `VALID SHAPE != TRUSTED ORIGIN`.

## Group A — trusted composition boundary

`createActionAuthorityRuntime({ capabilityRuntime, authorityStore,
trustedScopeBindings, clock })` is the SINGLE trusted composition root. It
constructs and binds, inside a trusted closure:

- trusted RuntimeIdentity issuer (`mintRuntimeIdentity`, closure-only brand)
- trusted capability-bound scope resolvers (closed mapping)
- canonical Authority read-only evaluator (`loadAndEvaluateAuthority`)
- ActionIntent admission
- ActionAuthorityGate

It returns ONLY least-privilege surfaces. Raw trust constructors (identity
minting, scope-resolver injection, generic authorityContext injection,
evaluation branding) are NOT exported.

### Runtime identity trust
A RuntimeIdentityContext carries an UNFORGEABLE brand token (WeakSet in module
closure). `isRuntimeIdentityContext` checks the brand, not shape. A plain
object, frozen clone, structurally identical object, JSON, or Symbol("same-name")
is rejected. Only `rt.issueIdentity(...)` (closure-bound) mints identities.

### Scope resolver trust
`createIntentAdmission({scopeResolver})` is REMOVED. Scope resolvers come only
from `trustedScopeBindings` (a closed `{capabilityId: {operation: resolverFn}}`
mapping). The caller submits only `arguments`. Missing resolver, resolver
exception, or non-array/unbounded result => fail closed at admission.

### Authority context/evaluation trust
The gate no longer accepts `{ evaluate() }`. It binds directly to the canonical
evaluator and to `isCanonicalAuthorityEvaluation` (brand verifier). A positive
AuthorityEvaluation is an internally-branded immutable value; a fake/copied/
cloned positive evaluation cannot manufacture ALLOW.

## Group B — one canonical authority semantic path

`loadAndEvaluateAuthority(store, request, opts)` is the SINGLE primitive that
fully rehydrates + validates a persisted grant and evaluates a request. Both
`AuthorityRegistry.authorize()` and the Lane 2 gate call it. No duplicated
policy/rehydration remains.

### Subject/principal binding (canonical, explicit)
- `identityBinding.principals` (non-empty) => `identity.principal` must be
  present and in it (delegation).
- no `identityBinding.principals` + non-empty `identity.principal` =>
  `identity.principal` must equal `grant.subject` (grant holder acting directly).
- empty principal + no principals binding => principal dimension unconstrained
  (existing channel/session-only semantics preserved).

### Complete rehydration / malformed state
`rehydrateGrant` validates subject, capabilityId (must match store key), kind,
actions, scope, allowedPurposes, restrictions (canonical restriction set, never
null), maxExecutions, generation (nonnegative safe int), identityBinding
(channels/sessionIds/principals arrays), dates (parseable), status. Any
malformed form (null/NaN/unknown) => DENY (fail closed).

## Decision model

`ALLOW | DENY | OWNER_CONFIRMATION_REQUIRED`, bound to `intentId`,
`capabilityId`, `capabilityIncarnationId`, `operation`, `principal`,
`authorityGeneration`, `reasonCode`, `evaluatedAtMs`.

## Public API (before -> after)

Before: exported `createRuntimeIdentityContext`, `createIntentAdmission`,
`createReadOnlyAuthorityContext`, `ActionAuthorityGate` (constructor with
injectable `authorityContext`).

After: exports `createActionAuthorityRuntime` (the only trust issuance surface),
`parseActionIntent` (untrusted ingress), inert constants (`DECISION`,
`GATE_REASONS`, `REASONS`, `ALLOW_REASON`), and read-only brand verifiers
(`isRuntimeIdentityContext`, `isCanonicalAuthorityEvaluation`).

## Preserved invariants

STRING-only hostile boundary, zero Proxy execution, recursive authority-shaped
rejection, intent/decision immutability, no execution, no actuation, no
Authority/Capability mutation, no channel-specific auth, hardened clock capture,
incarnation binding.

## Tests

`tests/action/`: `blockerIdentity.test.js`, `blockerEval.test.js`,
`trustOrigin.test.js`, `adversarial.test.js`, `security.test.js`,
`differential.test.js` (>=2000 cases incl. malformed, `lane2AllowCanonicalReject
== 0`, `lane2AllowCanonicalDeny == 0`), `storm.test.js` (>=12000 ops, 34 counters
zero).

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` semantic only (owner-auth flow later lane).
- `sqlite3` native module absent (non-differential env failures).
- Brand tokens are same-process closure/WeakSet boundaries (not OS isolation);
  documented honestly in `runtime.js`.
