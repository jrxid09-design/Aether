# Action Intent + Authority Gate V1 (caller-owned auth bootstrap REMOVED)

Status: candidate (post fifth repair, production-unwired)
Branch: `feat/action-authority-v1`
Base: `4831641` (Wave-4 runtime-local trust domain), on `b6b3904` sealed
runtime, `47827c9` certified Lane 1.
Code: `src/action/**`, `src/authority/evaluate.js`, `tests/action/**`

## Purpose

Answers exactly two questions, without executing anything:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

## Trust split (fifth repair)

The historical `createActionAuthorityRuntime({ onReady({ bindAuthentication }) })`
pattern handed a session-mint capability to the SAME caller constructing the
runtime. That violated the trust model: the caller that builds the runtime
could mint authenticated principals. The fifth repair removes that pattern
entirely and splits trust:

```
Trusted Aether bootstrap
        |
        v
createAuthenticationDomain({ authenticate })    [src/action/authDomain.js]
        |   owns, in its OWN closure:
        |     - authenticate(evidence) -> AuthSessionCapability | null
        |     - the runtime/session-domain brand (closure-local WeakSet)
        |     - the ONLY session mint path (authenticate() success)
        |     - the verifier capability
        v
trusted bootstrap creates ActionAuthorityRuntime using authDomain.verifier
        |
        |   inside the runtime composition closure:
        |     - canonical Authority evaluator (loadAndEvaluateAuthority)
        |     - canonical evaluation brand verifier
        |       (isCanonicalAuthorityEvaluation)
        |     - sealed gate (PRIVATE closure helper; no importable constructor)
        |     - hardened clock (read-once function identity)
        |     - trusted scope resolvers (captured ONCE, detached)
        |     - the captured pre-bound verifier FUNCTION IDENTITY only
        v
returns least-privilege surface EXACTLY:
        admit(serializedProposal)       (identity-free canonical intent)
        evaluate(intent, authSession)   (AuthorityDecision)
```

`ActionAuthorityRuntime` REQUIRES a pre-bound `authVerifier` capability from
trusted bootstrap. It does NOT mint users, does NOT authenticate arbitrary
principal strings, and exposes NO caller-owned auth bootstrap:

- no `onReady` / `bindAuthentication` / `mintSession` / `issuer` surface
  exists on the runtime, its constructor options, or any module export.
- any caller-bootstrap option key passed to the constructor is REJECTED at
  composition with `CALLER_BOOTSTRAP_REJECTED`.
- authentication failure (null / undefined / false / malformed / throws)
  fails closed; there is NO fallback to caller-supplied identity.

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

## ActionAuthorityRuntime public surface

Exactly `{ admit, evaluate }`. It MUST NOT expose:

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

## Composition rejection laws

`createActionAuthorityRuntime` rejects at composition time with a typed
`ActionError` when:

- `authVerifier` is missing or not a pre-bound verifier capability
  (`AUTH_VERIFIER_REQUIRED`) — there is no path to a runtime that evaluates
  identities without a trusted verifier.
- Any caller-bootstrap option key is present
  (`CALLER_BOOTSTRAP_REJECTED`) — there is no caller-owned auth bootstrap.
  Forbidden keys include: `onReady`, `bindAuthentication`, `mintSession`,
  `issueIdentity`, `issueSession`, `issuer`, `sessionIssuer`, `sessionBrand`,
  `authBrand`, `authBinder`, `bootstrap`, `createAuthSessionIssuer`,
  `authSessionIssuer`, `bootstrapCapability`, `trustedBootstrap`.

Injected evaluator/verifier options (`authorityEvaluator`,
`isCanonicalEvaluation`, `verifySession`, `evaluator`, `gate`) are NEVER read
for trust — they are simply ignored. Only the pre-bound verifier's
brand-acceptance decides identity.

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

- `createAuthenticationDomain` — trusted-bootstrap-only AuthenticationDomain
  factory (owns authenticate + session brand + mint path + verifier).
- `createActionAuthorityRuntime` — trusted-bootstrap-only evaluation runtime
  factory; REQUIRES a pre-bound `authVerifier`, accepts NO caller-owned auth
  bootstrap option.
- `parseActionIntent` — untrusted STRING-only ingress.
- Inert constants: `DECISION`, `GATE_REASONS`, `ALLOW_REASON`, `ActionError`,
  `REASONS`, `INTENT_*`.
- `isCanonicalAuthorityEvaluation` — read-only canonical evaluation brand
  verifier (no minting).

NOT exported: `createAuthSessionIssuer`, `createGate`, `mintAuthSession`,
`mintSession`, `issueIdentity`, `isAuthSession`, `bindAuthentication`,
`onReady`, `authBinder`, session brand state, evaluation brand state,
evaluator/verifier injection hooks, runtime-identity minting.

## Process / module isolation limitation (documented, not hidden)

This is a same-process CommonJS trust domain, NOT OS isolation. A hypothetical
untrusted same-process actor with unrestricted `require()` could still reach
the trusted bootstrap module itself and compose its OWN domain — but that
domain is a SEPARATE trust domain: it cannot read the session brand of, mint
for, or evaluate against any other domain. What the Lane 2 public/direct
surface guarantees is the absence of privileged issuer and gate construction,
evaluator/verifier injection, and ANY caller-owned auth bootstrap callback.
Path naming ("src/..." vs "bootstrap") is NOT claimed as a security boundary.

## Tests

`tests/action/`: `blockerIdentity.test.js` (13), `blockerEval.test.js` (5),
`trustOrigin.test.js` (14), `adversarial.test.js` (8), `security.test.js` (6),
`differential.test.js` (1, >=2200 cases), `storm.test.js` (2, >=12000 ops,
48 counters zero), `runtimeDomain.test.js` (13 — Wave-4 repros + structural
export scan), `authBootstrap.test.js` (19 — Wave-4 fifth-repair repros +
structural scans).

Total: 81 tests, 0 failures.

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
authFailurePrincipalFallback, retainedAuthBindingReplay
```

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` semantic only (owner-auth flow later lane).
- `sqlite3` native module absent in this environment (non-differential
  authority tests requiring persistence fail with `Cannot find module
  'sqlite3'` — environmental, not Lane 2; identical on the baseline commit).
- Brand tokens + closure are same-process boundaries (documented honestly,
  not OS isolation; see "Process / module isolation limitation" above).
