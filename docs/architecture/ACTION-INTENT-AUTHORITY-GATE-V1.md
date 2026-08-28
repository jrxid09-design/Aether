# Action Intent + Authority Gate V1 (canonical bootstrap ownership — caller-selectable verifier REMOVED)

Status: candidate (post SIXTH repair, production-unwired)
Branch: `feat/action-authority-v1`
Base: `ff7f967` (Wave-4 fifth repair), on `4831641` runtime-local trust
domain, `b6b3904` sealed runtime, `47827c9` certified Lane 1.
Code: `src/action/**`, `src/authority/evaluate.js`, `tests/action/**`

## Purpose

Answers exactly two questions, without executing anything:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

## Canonical bootstrap ownership (sixth repair — CORE LAW)

CORE LAW:

```
caller-selectable verifier != authenticated identity authority
```

Before the sixth repair the public action package exported both
`createAuthenticationDomain` and `createActionAuthorityRuntime`, and the
runtime constructor accepted a caller-supplied `authVerifier`. That meant
any caller that possessed canonical CapabilityRuntime + AuthorityStore
references could select the identity verifier governing canonical
authorization:

```
attacker obtains canonical CapabilityRuntime
attacker obtains canonical AuthorityStore
attacker creates new action runtime around them
attacker selects verifier
attacker impersonates victim
```

Shape validation or branding inside a caller-created AuthenticationDomain did
NOT solve this, because the attacker could create the domain itself.

### Canonical ownership graph

The sixth repair removes that hole by owning canonical composition INTERNALLY.
There is exactly ONE canonical ActionAuthorityRuntime, assembled by a trusted
runtime/bootstrap layer (`src/action/bootstrap.js`). The public/downstream
Action package exposes no factories that let callers construct another
authority runtime over canonical state.

```
AETHER TRUSTED BOOTSTRAP LAYER  (src/action/bootstrap.js)
        │
        │ owns (constructed once, internally — NOT caller-supplied):
        ├── canonical CapabilityRuntime   (via createCapabilityRuntime)
        ├── canonical AuthorityStore      (via createMemoryAuthorityStore)
        ├── canonical AuthenticationDomain (via createAuthenticationDomain)
        │     - owns authenticate(...)
        │     - owns the runtime/session-domain brand (closure-local WeakSet)
        │     - owns the ONLY session mint path (authenticate() success)
        │     - owns the verifier capability (brand-first, zero-trap)
        ├── canonical trusted scope bindings (captured ONCE, detached)
        └── hardened clock (read-once function identity)
                │
                ▼
        INTERNAL composition only (createActionAuthorityRuntime, called here)
                │
                ▼
        Canonical ActionAuthorityRuntime
                │
                ▼
        frozen least-privilege facade returned to downstream:
            { admit, evaluate, authenticate, session }
```

Downstream (Console, CLI, Telegram, WhatsApp, Companion, extensions,
devices, providers) receives ONLY this facade. They MUST NOT choose:

- auth verifier
- AuthenticationDomain
- Authority store
- Capability registry/runtime
- canonical evaluator
- evaluation verifier
- gate implementation

### Host-bound composition capability (the mechanism)

`createActionAuthorityRuntime` and `createAuthenticationDomain` are NO LONGER
module exports. They are reachable only through `bindCompositionHost(module)`
/ `bindAuthenticationHost(module)` inside `src/action/runtime.js` and
`src/action/authDomain.js`. Binding is ONE-SHOT per process: a second bind
attempt from ANY module throws `CALLER_BOOTSTRAP_REJECTED`. The trusted
bootstrap layer (`src/action/bootstrap.js`) binds itself ONCE at load and
composes the canonical runtime with verifier/state IT constructed
internally. Downstream `require()` of the same paths gets the already-bound
modules and can never re-bind.

`createCanonicalActionRuntime` (the bootstrap's own entry) does NOT accept
`authVerifier`, `capabilityRuntime`, `authorityStore`, `authenticate` (the
identity-verifier surface), or any composition primitive as a caller option.
All canonical state is constructed INSIDE the bootstrap closure. The only
caller-supplied inputs are NON-PRIVILEGED:

- `clock` (hardened, read-once; identity captured, object never retained)
- `trustedScopeBindings` (resolver FUNCTION IDENTITIES captured once into a
  detached closure-owned Map; these resolve scope tokens only, never
  identity or authority)
- `authenticate` (the trusted external authentication INFRASTRUCTURE hook,
  NOT a verifier; returns an authenticated principal record from external
  evidence, on ANY failure fails closed without minting)

`authenticate` is NOT a verifier and is NOT caller-trust: it is the trusted
authentication infrastructure owned by bootstrap (e.g. token-guarded
transport in production, a controlled test authenticator in tests). The
verifier capability is created INSIDE the bootstrap closure over the
AuthenticationDomain's brand and is never handed to a caller.

### No caller-selectable verifier (Blocker 2 — sixth repair)

A caller possessing `fakeVerifier = { verify: () => "victim" }` has NO API
through which it can attach `fakeVerifier` to canonical
`CapabilityRuntime` / `AuthorityStore` / `ActionAuthorityRuntime`:

- the public action API exports no `createActionAuthorityRuntime`
- direct submodule imports of `src/action/runtime.js` expose no
  `createActionAuthorityRuntime`
- the trusted bootstrap's `createCanonicalActionRuntime` REJECTS
  `authVerifier` (and every other privileged composition option) at
  composition with `CALLER_BOOTSTRAP_REJECTED`

### Authentication domain ownership (Blocker 3 — sixth repair)

`createAuthenticationDomain` is NOT a module export. A downstream caller can
no longer do `createAuthenticationDomain({ authenticate: () => ({principal:"victim"}) })`
and use that domain as canonical identity authority. Canonical trust depends
on bootstrap OWNERSHIP (the domain is constructed inside the trusted
bootstrap closure), not on mere possession of the factory. A caller-forged
domain (reachable only through the bootstrap's own isolated-domain facility,
or a separately-loaded bootstrap in another process) mints sessions valid
only in the caller's own separate trust domain — never in the canonical one.

Canonical channel/auth adapters interact conceptually as:

```
external credentials
      ↓
canonical Authentication service   (bootstrap-owned authenticate infra)
      ↓
canonical AuthSessionCapability     (bootstrap-minted, branded)
      ↓
canonical ActionAuthorityRuntime.evaluate(...)
```

Channel code MUST NOT create AuthenticationDomains.

## AuthenticationDomain (src/action/authDomain.js)

Created ONLY by trusted Aether bootstrap, OUTSIDE the public action runtime
constructor. Its closure owns:

- `authenticate(evidence)` — the single public identity surface. Resolves
  external channel/session evidence through the trusted authenticator bound by
  bootstrap. On ANY failure (throw, null, undefined, malformed, missing
  principal) returns `null` — fail closed, nothing minted, no caller-identity
  fallback. On success it mints a session branded to THIS domain and carrying
  the principal that trusted authentication established — nothing else.
- `verifier` — the ONLY capability ActionAuthorityRuntime receives. Brand-first
  (zero property access before membership check => zero Proxy traps on
  rejection). Returns the authenticated principal string for a session branded
  by THIS domain, or null for anything else.
- The session brand `WeakSet` — closure-local, not module-global, not shared,
  not reachable from any other domain or caller. The only adder is the
  authenticated mint path above; the only reader is the verifier above.

### Fail-closed authentication law (no caller-principal fallback, ever)

`authenticate(evidence)` returns:

- a record with a non-empty string principal -> AUTHENTICATED (mint a session)
- null / undefined / false / `""` / `0` / missing principal / non-string
  principal / malformed / throws -> AUTH FAILED

On AUTH FAILED nothing is minted, nothing is branded, and no identity field
from the evidence (`principal` / `requestedPrincipal` / `claimedPrincipal` /
any caller string) is ever used as Authority identity. Caller-asserted name
strings are retained only as descriptive telemetry (`claimedPrincipal`), never
as Authority identity.

### AuthenticationDomain surface

Exactly `{ authenticate, verifier }`. NO `mintSession`, NO `issuer`, NO
`bindAuthentication`, NO `onReady`, NO brand accessor, NO `isAuthSession`.

## ActionAuthorityRuntime surface (bootstrap-issued)

Exactly `{ admit, evaluate }` on the runtime surface (the trusted bootstrap's
facade adds the authenticated-session mint path and bootstrap-owned seeding
helpers; see the ownership graph above). It MUST NOT expose:

- onReady, bindAuthentication, mintSession, issueIdentity, issueSession,
  createAuthSessionIssuer, authBinder, bootstrap, bootstrapCapability,
  trustedBootstrap, issuer, sessionIssuer, sessionBrand, authBrand,
  authVerifier, verifier, authDomain, gate, createGate, isAuthSession,
  session brand, session verifier internals, or any bootstrap callback.

## Runtime-local session brand design (unchanged from Wave 4)

The session brand is a `new WeakSet()` declared INSIDE the
`createAuthenticationDomain` closure. It is:

- **closure-local**: reachable only by the authenticated mint path and the
  verifier created in the same call. Not a module global, not a property of
  any exported object, not reachable from any other domain or caller.
- **per-domain**: every `createAuthenticationDomain` call creates a fresh,
  independent brand. There is no shared brand across domains.
- **unforgeable**: a session is accepted by runtime A's gate iff it was added
  to domain A's `sessionBrand` by domain A's authenticated mint path. Adding a
  plausible `runtimeId: "A"` string field to a session object carries zero
  trust weight — the decision is object-identity based (WeakSet membership),
  never string comparison.
- **brand-first verified**: `verify(session)` checks `sessionBrand.has(session)`
  BEFORE any property access, so a hostile Proxy cannot execute traps during
  rejection of an unbranded value.

Cross-runtime law (unchanged):

```
domainA session -> accepted only by the runtime composed over domainA
domainB session -> rejected by runtime A (INVALID_IDENTITY), and vice versa
```

This holds even when two runtimes are composed over the SAME canonical
capability registry + authority store: each runtime's AuthenticationDomain
mints its own brand, so a victim session minted by domain A is not in domain
B's brand and cannot be verified by B's gate. The attacker's own freshly
minted "victim" session is valid only on the attacker's runtime, proving
nothing about domain A.

## Composition rejection laws (bootstrap-internal factory)

The internal `createActionAuthorityRuntime` (reachable only through the
one-shot host-bound composition capability) rejects at composition time with
a typed `ActionError` when:

- `authVerifier` is missing or not a pre-bound verifier capability
  (`AUTH_VERIFIER_REQUIRED`) — there is no path to a runtime that evaluates
  identities without a trusted verifier.
- Any caller-bootstrap option key is present
  (`CALLER_BOOTSTRAP_REJECTED`) — there is no caller-owned auth bootstrap.
  Forbidden keys include: `onReady`, `bindAuthentication`, `mintSession`,
  `issueIdentity`, `issueSession`, `issuer`, `sessionIssuer`, `sessionBrand`,
  `authBrand`, `authBinder`, `bootstrap`, `createAuthSessionIssuer`,
  `authSessionIssuer`, `bootstrapCapability`, `trustedBootstrap`.

`createCanonicalActionRuntime` (the trusted bootstrap's own entry) rejects
every privileged composition option with `CALLER_BOOTSTRAP_REJECTED`:
`authVerifier`, `verifier`, `capabilityRuntime`, `authorityStore`, `authDomain`,
`domain`, `authenticationDomain`, `sessionBrand`, `authBrand`, `brand`,
`evaluator`, `authorityEvaluator`, `isCanonicalEvaluation`, `verifySession`,
`evaluateSession`, `gate`, `createGate`, `registry`, `capabilityRegistry`,
`store`, and the full caller-bootstrap key family. The only caller-supplied
inputs are the non-privileged `clock`, `trustedScopeBindings`,
`authenticate` (trusted authentication infrastructure, NOT a verifier), and
`capabilityRuntimeOptions` (non-privileged registrar spec).

Injected evaluator/verifier options (`authorityEvaluator`,
`isCanonicalEvaluation`, `verifySession`, `evaluator`, `gate`) are NEVER read
for trust — they are simply ignored (and at the bootstrap layer, rejected
outright). Only the pre-bound verifier's brand-acceptance decides identity.

## Blocker resolutions

### B1 (Wave 4) — public session issuer removed
`createAuthSessionIssuer` is removed from `src/action/index.js` and from
`src/action/authSession.js`. There is no public or direct-import path that
mints a session trusted by any canonical runtime.

### B2 (Wave 4) — direct module import exposes injectable gate (closed)
`createGate` is removed from `src/action/gate.js`. The gate is a PRIVATE
closure helper inside `createActionAuthorityRuntime`; constructed exactly
once, over closure-owned dependencies only.
`require("src/action/gate").createGate === undefined`.

### B3 (Wave 4) — session brand is domain-local (not module-global)
The Wave-3 module-global `authSessionBrands = new WeakSet()` is gone. The brand
is a closure-local `const sessionBrand = new WeakSet()` inside each
AuthenticationDomain composition. Cross-runtime replay is rejected in both
directions without `runtimeId` strings.

### B1 + B2 + B3 (Wave 4 fifth repair) — caller-owned auth bootstrap removed
The `onReady({ bindAuthentication })` hook is DELETED from
`createActionAuthorityRuntime` and from the runtime surface entirely.
Authentication/session issuance is established OUTSIDE the public action
runtime constructor by trusted bootstrap via `createAuthenticationDomain`.
The runtime receives only the already-bound `verifier` capability. There is
no callback obtainable by a runtime caller that can mint authenticated
principals; no `bindAuthentication`/`mintSession`/`issuer` surface exists on
the runtime, its constructor options, or any module export. Authentication
failure fails closed with NO fallback to caller-supplied identity
(`fields.principal` / `requestedPrincipal` / `claimedPrincipal`).

### Sixth repair — canonical bootstrap ownership (caller-selectable verifier removed)
The fifth repair still left `createActionAuthorityRuntime` and
`createAuthenticationDomain` as PUBLIC EXPORTS, and the runtime constructor
still accepted a caller-supplied `authVerifier`. A caller that possessed
canonical CapabilityRuntime + AuthorityStore references could compose a NEW
runtime around them with ITS OWN verifier and impersonate a victim principal
the canonical store grants. The sixth repair closes that hole:

- `createActionAuthorityRuntime` and `createAuthenticationDomain` are NO
  LONGER module exports. They are reachable only through a one-shot
  host-bound composition capability (`bindCompositionHost` /
  `bindAuthenticationHost`) that the trusted bootstrap layer binds at load.
- `src/action/bootstrap.js` is the ONE trusted composition layer; it owns
  canonical state (CapabilityRuntime, AuthorityStore, AuthenticationDomain,
  verifier) constructed INSIDE its closure.
- The public action API exports only `parseActionIntent`, inert constants,
  and `isCanonicalAuthorityEvaluation`.
- A fake verifier `{ verify: () => "victim" }` has NO path into the canonical
  runtime.
- A caller-created AuthenticationDomain cannot become canonical identity
  authority.
- A caller cannot wrap canonical state references in an attacker runtime.

## Preserved invariants (all prior closed properties retained)

- runtime-local session domains (now via AuthenticationDomain)
- cross-runtime replay rejection (closure-local brand, never strings)
- sealed gate (PRIVATE closure helper; no importable constructor)
- detached scope bindings (function identity captured ONCE)
- canonical shared Authority evaluator (`loadAndEvaluateAuthority`)
- subject/principal binding (identityBinding / grant.subject)
- malformed grants fail closed
- incarnation-bound intents
- clock hardening (read-once function identity)
- string-only hostile ingress
- brand-first Proxy rejection (zero traps)
- zero execution, zero actuation
- zero Authority mutation
- zero Capability mutation
- canonical AuthorityEvaluation branding (`isCanonicalAuthorityEvaluation`)

## Public API

Exports (`src/action/index.js`):

- `parseActionIntent` — untrusted STRING-only ingress.
- Inert constants: `DECISION`, `GATE_REASONS`, `ALLOW_REASON`, `ActionError`,
  `REASONS`, `INTENT_*`.
- `isCanonicalAuthorityEvaluation` — read-only canonical evaluation brand
  verifier (no minting).

NOT exported (from index.js or ANY action submodule):
`createActionAuthorityRuntime`, `createAuthenticationDomain`, `createGate`,
`createAuthSessionIssuer`, `mintAuthSession`, `mintSession`, `issueIdentity`,
`isAuthSession`, `bindAuthentication`, `onReady`, `authBinder`, session brand
state, evaluation brand state, evaluator/verifier injection hooks,
runtime-identity minting, and any bootstrap factory callable with
caller-selected dependencies.

Privileged composition lives in `src/action/bootstrap.js` — the trusted
Aether runtime/bootstrap layer — which exposes exactly
`{ createCanonicalActionRuntime, PRIVILEGED_KEYS }`. Its composition entry
accepts NO verifier, domain, store, registry, evaluator, or gate option; all
canonical state is constructed inside its closure.

## Process / module isolation limitation (documented, not hidden)

This is a same-process CommonJS trust domain, NOT OS isolation. Node/CommonJS
path hiding is NOT hard sandboxing against code that already has arbitrary
same-process filesystem/require execution — path secrecy is NOT claimed as a
security boundary. An untrusted same-process actor with unrestricted
`require()` could still reach the trusted bootstrap module itself and compose
its OWN runtime with its OWN authenticate hook — but the resulting runtime is
a SEPARATE trust domain with a SEPARATE AuthenticationDomain brand: it cannot
read the session brand of, mint for, or evaluate against the canonical
runtime. What Lane 2 enforces is the enforceable contract:

- the ordinary/downstream Action API exposes NO authority composition
  primitive at all
- canonical bootstrap owns composition (one-shot host binding; canonical
  state + verifier constructed inside the trusted closure)
- downstream receives least-privilege facades only
- untrusted executable extensions must eventually require loader
  allowlisting, sandboxing, workers/process isolation, or equivalent
  enforcement


## Tests

`tests/action/`: `blockerIdentity.test.js` (13), `blockerEval.test.js` (5),
`trustOrigin.test.js` (12), `adversarial.test.js` (8), `security.test.js` (6),
`differential.test.js` (1, >=2200 cases), `storm.test.js` (2, >=12000 ops,
52 counters zero), `runtimeDomain.test.js` (13 — Wave-4 repros + structural
export scan), `authBootstrap.test.js` (16 — Wave-4 fifth-repair repros +
structural scans), `canonicalBootstrap.test.js` (16 — SIXTH repair regressions:
public factory absence, fake-verifier no-path, attacker-runtime-over-canonical
rejection, one-shot host binding, dependency direction).

Total: 92 tests, 0 failures.

Storm counters (all zero, all with active detection paths):

```
executions, actuations, authorityMutations, capabilityMutations,
forgedAuthorityAccepted, modelAuthorityAccepted, memoryAuthorityAccepted,
channelAuthorityAccepted, staleIncarnationAllowed, staleAuthorityAllowed,
undeclaredOperationAllowed, unavailableCapabilityAllowed, partialMutation,
hostileCallerCodeExecution, canonicalStateEscape, untypedErrors, openHandles,
identitySpoofAllowed, channelSpoofAllowed, sessionSpoofAllowed,
scopeBypassAllowed, authorityReadFailureAllowed,
malformedAuthorityEvaluationAllowed, staleUnboundIntentAllowed,
invalidTimestampAccepted, lane2AllowCanonicalDeny,
forgedRuntimeIdentityAccepted, clonedRuntimeIdentityAccepted,
forgedScopeResolverAccepted, fakeAuthorityContextAllowed,
forgedAuthorityEvaluationAllowed, subjectPrincipalMismatchAllowed,
malformedGrantAllowed, lane2AllowCanonicalReject,
arbitraryPrincipalMinted, canonicalStateImpersonation,
evaluatorReplacementSucceeded, canonicalVerifierReplacementSucceeded,
scopeBindingMutationAffectedRuntime, hostileIdentityTrapExecution,
# Wave-4 fourth repair (runtime-local trust domain)
publicIssuerMintedVictim, crossRuntimeSessionAccepted,
directGateInjectionSucceeded, forgedSessionAccepted,
# Wave-4 fifth repair (caller-owned auth bootstrap removed)
callerObtainedAuthBinder, callerObtainedSessionMint,
authFailurePrincipalFallback, retainedAuthBindingReplay,
# Wave-4 SIXTH repair (canonical bootstrap ownership)
publicActionRuntimeFactoryExposed, publicAuthenticationDomainFactoryExposed,
callerSelectedVerifierAccepted, canonicalStateReboundByAttacker
```

The four sixth-repair counters have ACTIVE detection paths: they fire only if
a composition factory reappears on a public/direct surface, if a
caller-selected verifier ever reaches a canonical runtime, or if an attacker
runtime over canonical state ever accepts/defers trust across brands.

Test-process note: `node --test` runs each test FILE in its own process. The
one-shot host binding is per-process; `canonicalBootstrap.test.js` loads the
PRODUCTION bootstrap (`src/action/bootstrap.js`) in its own process, while all
other suites use the trusted test bootstrap
(`tests/action/bootstrapHarness.js`) that mirrors the production composition
layer. Both paths prove the same law: canonical state, the AuthenticationDomain,
and the verifier are constructed INSIDE the trusted closure; no caller can
supply a verifier, domain, runtime, store, evaluator, or gate.

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` semantic only (owner-auth flow later lane).
- `sqlite3` native module absent in this environment (non-differential
  authority tests requiring persistence fail with `Cannot find module
  'sqlite3'` — environmental, not Lane 2; identical on the baseline commit).
- Brand tokens + closure are same-process boundaries (documented honestly,
  not OS isolation; see "Process / module isolation limitation" above).
