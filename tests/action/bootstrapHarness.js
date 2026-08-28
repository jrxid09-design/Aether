"use strict";

/**
 * ACTION AUTHORITY GATE V1 — TRUSTED TEST BOOTSTRAP (sixth repair).
 *
 * This file is the trusted-bootstrap equivalent for the action test suite.
 * In Lane 2's evaluation-only architecture there is no production wiring of
 * the canonical runtime yet, so the test harness plays the role of the trusted
 * Aether runtime/bootstrap layer (mirroring src/action/bootstrap.js). This
 * helper centralizes that role so every test file composes through ONE
 * trusted path.
 *
 * This module is NOT shipped as a public/downstream API. It lives under
 * tests/ and mirrors the production trusted bootstrap's ownership law:
 *   - canonical state is constructed INSIDE this closure
 *   - the identity verifier is constructed INSIDE this closure
 *   - no caller of makeHarness can supply a verifier, an AuthenticationDomain,
 *     a capabilityRuntime, an authorityStore, or any evaluator/gate
 *
 * For cross-domain / cross-runtime replay proofs, the harness additionally
 * exposes `composeIsolatedTrustDomain`, which builds a SECOND, structurally
 * identical but brand-distinct trust domain. This is the trusted bootstrap's
 * own internal facility for minting an adversarial "domain B"; it is NOT a
 * public trust factory and grants no access to the canonical domain's brand.
 */

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
// Trusted-bootstrap-internal composition capabilities. Tests reach the
// internal factory surface via the SAME one-shot host binding the production
// bootstrap uses; this file binds itself as host, mirroring src/action/bootstrap.js.
const { bindCompositionHost } = require("../../src/action/runtime");
const { bindAuthenticationHost } = require("../../src/action/authDomain");
const { ActionError, REASONS } = require("../../src/action/errors");

const CLOCK_START = 1_000_000;

let BOUND = null;
function hosts() {
    if (!BOUND) {
        BOUND = {
            composition: bindCompositionHost(module),
            authentication: bindAuthenticationHost(module)
        };
    }
    return BOUND;
}

function manualClock(startMs = CLOCK_START) {
    let t = startMs;
    return {
        nowMs: () => t,
        nowIso: () => new Date(t).toISOString(),
        advance(ms) { t += ms; return t; },
        get value() { return t; }
    };
}

function defaultScopeResolver(args) {
    const target = args && typeof args.target === "string" ? args.target.trim().toLowerCase() : "";
    return target ? [target] : [];
}

/** Trusted test authenticator: accepts whatever principal bootstrap asserts
 *  (mirrors external trusted auth infra bound during bootstrap). */
function authenticate(evidence) {
    const p = evidence && typeof evidence === "object" ? evidence.claimedPrincipal : null;
    if (typeof p === "string" && p.length > 0) {
        return { principal: p };
    }
    return null;
}

/**
 * Build the canonical trusted harness. Mirrors src/action/bootstrap.js:
 *   { registry, registrars, store, clock, authDomain, rt, session,
 *     mintAuthSession, registerCapability, grantAuthority, admit, evaluate,
 *     gate }
 *
 * `authDomain` is the trusted AuthenticationDomain created by this harness's
 * bootstrap; it owns authenticate(), the session brand, and the verifier
 * capability handed to the runtime. `rt` is the trusted runtime surface:
 * exactly { admit, evaluate }. `session(principal, extra)` mints through the
 * domain's authenticate() path (trusted infra).
 */
async function makeHarness({ clock, scopeBindings, authenticate: authenticateFn = authenticate } = {}) {
    const c = clock ?? manualClock();
    const capabilityRuntime = createCapabilityRuntime({
        registrars: { core: true },
        clock: { nowMs: () => c.nowMs() }
    });
    const store = createMemoryAuthorityStore();

    const bindings = scopeBindings ?? {
        "filesystem.read": { read: defaultScopeResolver, write: defaultScopeResolver },
        "filesystem.write": { write: defaultScopeResolver }
    };

    // ---- trusted bootstrap: AuthenticationDomain established INSIDE this
    // closure. It owns authenticate(), the session brand, the only mint path,
    // and the verifier capability. The runtime is composed over the domain's
    // pre-bound verifier only. ----
    const { createAuthenticationDomain } = hosts().authentication;
    const { createActionAuthorityRuntime } = hosts().composition;
    const authDomain = createAuthenticationDomain({
        authenticate: authenticateFn,
        clock: { nowMs: () => c.nowMs() }
    });
    const rt = createActionAuthorityRuntime({
        capabilityRuntime,
        authorityStore: store,
        authVerifier: authDomain.verifier,
        trustedScopeBindings: bindings,
        clock: { nowMs: () => c.nowMs() }
    });

    async function registerCapability(overrides = {}) {
        const descriptor = {
            schemaVersion: 1,
            id: "filesystem.read",
            kind: "system",
            provider: "core",
            operations: ["read"],
            requirements: [],
            effects: [],
            ...overrides
        };
        return capabilityRuntime.registrars.core.register(JSON.stringify(descriptor));
    }

    async function grantAuthority({ capabilityId = "filesystem.read", subject = "alice", actions = ["read"], scope = [], generation = 0, identityBinding = null } = {}) {
        const grant = {
            capabilityId, kind: "root", subject,
            issuer: "owner-ratification:test",
            actions, scope, allowedPurposes: [],
            restrictions: { kind: "unrestricted" }, maxExecutions: null, usedExecutions: 0,
            issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
            status: "ACTIVE", generation, delegationDepth: 0, remainingDelegationDepth: 2,
            parentCapabilityId: null, rootCapabilityId: capabilityId, ratificationId: null,
            identityBinding, extra: null
        };
        await store.upsertCapability(capabilityId, "ACTIVE", generation, JSON.stringify(grant));
    }

    function session(principal = "alice", extra = {}) {
        const evidence = { claimedPrincipal: principal, ...extra };
        const s = authDomain.authenticate(evidence);
        if (!s) throw new ActionError(REASONS.AUTH_FAILED, "test authenticate failed closed; no session minted");
        return s;
    }

    function mintAuthSession(evidence) {
        return authDomain.authenticate(evidence);
    }

    return {
        registry: capabilityRuntime.registry,
        registrars: capabilityRuntime.registrars,
        store, clock: c, authDomain, rt,
        session,
        mintAuthSession,
        admit: rt.admit,
        evaluate: rt.evaluate,
        gate: rt,
        registerCapability, grantAuthority
    };
}

/**
 * Build a SECOND, structurally-identical but brand-distinct trust domain for
 * cross-domain / cross-runtime replay proofs. The returned domain is a
 * SEPARATE trust domain: its session brand is independent, and a session
 * minted here is NEVER valid on the canonical harness's runtime (and vice
 * versa), even when composed over the same canonical registry+store.
 *
 * `capabilityRuntime` / `authorityStore` may be passed to share canonical
 * state (for the "shared canonical state does NOT federate session trust"
 * proof). When omitted, fresh isolated state is constructed.
 */
function composeIsolatedTrustDomain({
    clock = { nowMs: () => 1000 },
    authenticate: authenticateFn = authenticate,
    capabilityRuntime = null,
    authorityStore = null,
    trustedScopeBindings = { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } }
} = {}) {
    const capRt = capabilityRuntime ?? createCapabilityRuntime({ registrars: { core: true }, clock });
    const store = authorityStore ?? createMemoryAuthorityStore();
    const { createAuthenticationDomain } = hosts().authentication;
    const { createActionAuthorityRuntime } = hosts().composition;
    const authDomain = createAuthenticationDomain({ authenticate: authenticateFn, clock });
    const rt = createActionAuthorityRuntime({
        capabilityRuntime: capRt,
        authorityStore: store,
        authVerifier: authDomain.verifier,
        trustedScopeBindings,
        clock
    });
    return { capabilityRuntime: capRt, authorityStore: store, authDomain, rt };
}

/**
 * Trusted-bootstrap test facility: compose an internal runtime over an
 * ARBITRARY authority store (hostile/failing stores for the fail-closed
 * matrix). This mirrors the internal composition surface that only the
 * trusted bootstrap layer can reach; it exists under tests/ solely to prove
 * the runtime's fail-closed behavior against hostile stores. It is NOT part
 * of any public/downstream API.
 *
 * `runtimeClock` may be supplied separately from the AuthenticationDomain's
 * `clock`: the B6 clock-hardening tests build a valid authDomain and then
 * pass a hostile clock to the runtime to prove the runtime's own validation
 * rejects.
 */
function composeRuntimeOverStore({
    authorityStore,
    capabilityRuntime = null,
    clock = { nowMs: () => 1000 },
    runtimeClock = null,
    authenticate: authenticateFn = authenticate,
    trustedScopeBindings = { "filesystem.read": { read: (a) => (a && a.target ? [a.target] : []) } },
    authDomain = null
} = {}) {
    const capRt = capabilityRuntime ?? createCapabilityRuntime({ registrars: { core: true }, clock });
    const { createAuthenticationDomain } = hosts().authentication;
    const { createActionAuthorityRuntime } = hosts().composition;
    const domain = authDomain ?? createAuthenticationDomain({ authenticate: authenticateFn, clock });
    const rt = createActionAuthorityRuntime({
        capabilityRuntime: capRt,
        authorityStore,
        authVerifier: domain.verifier,
        trustedScopeBindings,
        clock: runtimeClock ?? clock
    });
    return { capabilityRuntime: capRt, authorityStore, authDomain: domain, rt };
}

module.exports = {
    manualClock,
    makeHarness,
    composeIsolatedTrustDomain,
    composeRuntimeOverStore,
    defaultScopeResolver,
    authenticate,
    CLOCK_START,
    // The trusted test bootstrap's raw composition capability (mirrors what
    // src/action/bootstrap.js holds). Test files play the trusted-bootstrap
    // role; downstream code never sees this.
    trusted: hosts()
};
