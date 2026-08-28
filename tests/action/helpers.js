"use strict";

/** Shared helpers for action intent + authority gate tests (caller-owned
 *  auth bootstrap REMOVED — fifth targeted repair).
 *
 *  The session issuer lives INSIDE a trusted AuthenticationDomain created by
 *  the test bootstrap (mirrors trusted Aether bootstrap). The runtime is then
 *  composed over the domain's pre-bound `verifier` capability only; it
 *  receives no mint, no bootstrap callback, and no caller-supplied identity.
 */

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { createActionAuthorityRuntime, createAuthenticationDomain } = require("../../src/action");

const CLOCK_START = 1_000_000;

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

/** Trusted test authentication: accepts whatever principal bootstrap asserts
 *  (mirrors external trusted auth infra bound during bootstrap). The
 *  AuthenticationDomain treats the principal the way an external authenticator
 *  would: it MUST return a non-empty string for a session to be minted; on any
 *  failure (null, undefined, malformed, throw) it fails closed. */
function authenticate(evidence) {
    const p = evidence && typeof evidence === "object" ? evidence.claimedPrincipal : null;
    if (typeof p === "string" && p.length > 0) {
        return { principal: p };
    }
    return null;
}

/**
 * Build a full trusted harness:
 *   { registry, registrars, store, clock, authDomain, rt, session,
 *     registerCapability, grantAuthority, mintAuthSession }
 *
 * `authDomain` is the trusted AuthenticationDomain created by this harness's
 * bootstrap; it owns authenticate(), the session brand, and the verifier
 * capability handed to the runtime.
 *
 * `rt` is the trusted runtime surface: exactly { admit, evaluate }, composed
 * over `authDomain.verifier` (the ONLY authentication capability it receives).
 *
 * `session(principal, extra)` mints an authenticated session through the
 * domain's authenticate() path (trusted infra). It cannot mint a principal
 * the authenticator does not endorse; failure to authenticate yields null
 * (fail closed) — mirroring the production trust model.
 *
 * `mintAuthSession(evidence)` exposes the domain's authenticate() surface for
 * direct fail-closed tests (null / undefined / malformed / throw).
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

    // ---- trusted bootstrap: AuthenticationDomain established OUTSIDE the
    // runtime constructor. It owns authenticate(), the session brand, the
    // only mint path, and the verifier capability. ----
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

    // Mint through the domain's authenticate() path (trusted infra). The
    // caller passes `principal`; the test authenticator echoes it back as
    // the authenticated principal. A test authenticator that refuses (null/
    // throws) makes session() throw — which is the documented fail-closed
    // behavior and is asserted explicitly in the dedicated fail-closed tests.
    function session(principal = "alice", extra = {}) {
        const evidence = { claimedPrincipal: principal, ...extra };
        const s = authDomain.authenticate(evidence);
        if (!s) throw new Error("test authenticate failed closed; no session minted");
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

module.exports = { manualClock, makeHarness, defaultScopeResolver, authenticate, CLOCK_START };
