# ACTION INTENT + AUTHORITY GATE V1 (runtime-local trust domain)

Status: candidate (post fourth repair, production-unwired)
Branch: `feat/action-authority-v1`
Base: `b6b3904` (Wave-3 sealed runtime), on `47827c9` certified Lane 1
Code: `src/action/**`, `src/authority/evaluate.js`, `tests/action/**`

## Purpose

Answers exactly two questions, without executing anything:

```
1. What action is being proposed?         (ActionIntent)
2. Is that proposed action authorized?    (AuthorityDecision)
```

## Canonical bootstrap trust architecture

```
Trusted Aether bootstrap
        |
        v
createActionAuthorityRuntime({ capabilityRuntime, authorityStore,
                               trustedScopeBindings, clock, onReady })
        |
        |  inside the composition closure, minted ONCE and never re-supplied:
        |    - runtime-local sessionBrand = new WeakSet()        (closure-only)
        |    - sessionIssuer   (mintSession -> adds to sessionBrand)
        |    - sessionVerifier (isAuthSession -> reads sessionBrand)
        |    - canonical Authority evaluator (loadAndEvaluateAuthority)
        |    - canonical evaluation brand verifier (isCanonicalAuthorityEvaluation)
        |    - sealed gate (PRIVATE closure helper; no importable constructor)
        |    - hardened clock (read-once function identity)
        |    - trusted scope resolvers (captured ONCE, detached)
        |
        |  onReady({ bindAuthentication })  <- one-time trusted bootstrap hook
        |     bootstrap calls bindAuthentication({ authenticate }) exactly once
        |     -> returns { mintSession } usable ONLY inside that bootstrap closure
        |
        v
returns least-privilege surface EXACTLY:
        admit(serializedProposal)       (identity-free canonical intent)
        evaluate(intent, authSession)   (AuthorityDecision)
```

No `mintSession`, no `issueIdentity`, no `bindAuthentication`, no `createGate`,
and no evaluator/verifier hook appears on the returned runtime surface or in
any public/direct module export. Downstream extension/device/provider/channel
code receives only `admit`/`evaluate` (plus, where appropriate,
already-authenticated session capabilities that bootstrap chose to forward).

## Runtime-local session brand design

The session brand is a `new WeakSet()` declared INSIDE
`createActionAuthorityRuntime`'s function body. It is:

- **closure-local**: reachable only by the `mintSession` and `isAuthSession`
  closures created in the same call. Not a module global, not a property of
  any exported object, not reachable from any other runtime or caller.
- **per-runtime**: every call to `createActionAuthorityRuntime` creates a
  fresh, independent brand. There is no shared brand across runtimes.
- **unforgeable**: a session is accepted by runtime A's gate iff it was added
  to runtime A's `sessionBrand` by runtime A's own `mintSession`. Adding a
  plausible `runtimeId: "A"` string field to a session object carries zero
  trust weight — the decision is object-identity based (WeakSet membership),
  never string comparison.
- **brand-first verified**: `isAuthSession(v)` checks `sessionBrand.has(v)`
  BEFORE any property access, so a hostile Proxy cannot execute traps during
  rejection of an unbranded value.

Cross-runtime law:

```
runtimeA session -> accepted only by runtimeA
runtimeB session -> rejected by runtimeA (INVALID_IDENTITY), and vice versa
```

This holds even when two runtimes are composed over the SAME canonical
capability registry + authority store: each runtime mints its own brand, so a
victim session minted by runtime A is not in runtime B's brand and cannot be
verified by B's gate. The attacker's own freshly minted "victim" session is
valid only on the attacker's runtime, proving nothing about domain A.

## Authentication binding (trusted bootstrap only)

External authentication infrastructure is bound exactly once during trusted
bootstrap via the `onReady` hook:

```js
const rt = createActionAuthorityRuntime({
    capabilityRuntime, authorityStore, trustedScopeBindings, clock,
    onReady: ({ bindAuthentication }) => {
        const { mintSession } = bindAuthentication({
            authenticate(creds) {
                // trusted auth infra: resolve creds to a principal record
                return authInfra.authenticate(creds);
            }
        });
        // mintSession is held ONLY in this bootstrap closure.
        // Forward already-authenticated sessions to downstream code if needed;
        // never forward mintSession itself.
    }
});
```

`bindAuthentication` throws if called a second time
(`INVALID_DECISION_STATE`). If bootstrap never binds authentication, no session
can ever be minted for that runtime and every `evaluate()` fails closed on
identity (`INVALID_IDENTITY`).

## Blocker resolutions (Wave 4)

### B1 — public session issuer removed
`createAuthSessionIssuer` is removed from `src/action/index.js` and from
`src/action/authSession.js`. There is no public or direct-import path that
mints a session trusted by any canonical runtime. The only issuer is the
closure-scoped `mintSession` returned by the one-time `bindAuthentication`,
held by trusted bootstrap. An arbitrary caller cannot create a "victim" session
trusted by a canonical runtime.

### B2 — direct module import exposes injectable gate (closed)
`createGate` is removed from `src/action/gate.js`'s `module.exports`. The gate
is a PRIVATE closure helper inside `createActionAuthorityRuntime`; it is
constructed exactly once, over closure-owned dependencies only.
`require("src/action/gate").createGate === undefined`. No caller-selectable
evaluator/verifier exists: `createActionAuthorityRuntime` accepts no
`authorityEvaluator`, `isCanonicalEvaluation`, `verifySession`, `gate`, or
`evaluator` option — any such keys passed are ignored (extra options are never
read for trust).

### B3 — session brand is runtime-local (not module-global)
The Wave-3 module-global `authSessionBrands = new WeakSet()` is gone. The brand
is a closure-local `const sessionBrand = new WeakSet()` inside each runtime
composition. Cross-runtime replay is rejected in both directions without
`runtimeId` strings (see "Runtime-local session brand design" above).

## Preserved invariants

- shared canonical Authority evaluator (`loadAndEvaluateAuthority`)
- subject/principal binding (identityBinding / grant.subject)
- malformed grant fail-closed
- scope resolver capture (function identity, detached from caller objects)
- immutable scope binding
- sealed gate surface (frozen `{ admit, evaluate }`)
- incarnation-bound intents
- clock hardening (read-once function identity)
- hostile Proxy brand-first rejection (zero traps)
- canonical AuthorityEvaluation branding (`isCanonicalAuthorityEvaluation`)
- zero execution, zero actuation, zero Authority mutation in Lane 2
- zero Capability mutation
- Lane 1 baseline 103/103

## Public API

Exports (`src/action/index.js`): `createActionAuthorityRuntime` (trust
issuance surface), `parseActionIntent` (untrusted STRING-only ingress),
inert constants (`DECISION`, `GATE_REASONS`, `ALLOW_REASON`, `ActionError`,
`REASONS`, `INTENT_*`), and the read-only canonical evaluation brand
verifier `isCanonicalAuthorityEvaluation`.

NOT exported: `createAuthSessionIssuer`, `createGate`, `mintAuthSession`,
`mintSession`, `issueIdentity`, `isAuthSession` (runtime-local by design),
session brand state, evaluation brand state, evaluator/verifier injection
hooks, runtime-identity minting.

## Process / module isolation limitation (documented, not hidden)

This is a same-process CommonJS trust domain, NOT OS isolation. A hypothetical
untrusted same-process actor with unrestricted `require()` could still reach
the trusted bootstrap module itself and compose its OWN runtime over its OWN
stores — but that runtime is a SEPARATE trust domain: it cannot read the
session brand of, mint for, or evaluate against any other runtime. What the
Lane 2 public/direct surface guarantees is the absence of privileged issuer and
gate construction and evaluator/verifier injection. Path naming ("src/..." vs
"bootstrap") is NOT claimed as a security boundary.

## Tests

`tests/action/`: `blockerIdentity.test.js` (13), `blockerEval.test.js` (5),
`trustOrigin.test.js` (14), `adversarial.test.js` (8), `security.test.js` (6),
`differential.test.js` (1, >=2200 cases), `storm.test.js` (2, >=12000 ops,
44 counters zero), `runtimeDomain.test.js` (13 — Codex repros + structural
export scan).

Total: 62 tests, 0 failures.

## Known nonblockers

- `OWNER_CONFIRMATION_REQUIRED` semantic only (owner-auth flow later lane).
- `sqlite3` native module absent in this environment (non-differential
  authority tests requiring persistence fail with MODULE_NOT_FOUND —
  environmental, not Lane 2).
- Brand tokens + closure are same-process boundaries (documented honestly,
  not OS isolation; see "Process / module isolation limitation" above).
