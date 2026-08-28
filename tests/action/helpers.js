"use strict";

/** Shared helpers for action intent + authority gate tests (runtime-local
 *  trust domain). The session issuer is INTERNAL to each runtime: tests obtain
 *  it only through the one-time trusted bootstrap `onReady` /
 *  `bindAuthentication` hook during composition. */

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { createActionAuthorityRuntime } = require("../../src/action");

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
 *  (mirrors external trusted auth infra bound during bootstrap). */
function authenticate(fields) {
    return { principal: fields.principal };
}

/**
 * Build a full trusted harness:
 *   { registry, registrars, store, clock, rt, session, registerCapability, grantAuthority }
 *
 * `rt` is the trusted runtime surface: exactly { admit, evaluate }.
 * `session(principal, extra)` mints a session in THIS runtime's trust domain
 * via the bootstrap-held issuer captured through onReady/bindAuthentication.
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

    let issuer = null;
    const rt = createActionAuthorityRuntime({
        capabilityRuntime,
        authorityStore: store,
        trustedScopeBindings: bindings,
        clock: { nowMs: () => c.nowMs() },
        onReady: ({ bindAuthentication }) => {
            issuer = bindAuthentication({ authenticate: authenticateFn });
        }
    });
    if (!issuer) throw new Error("test bootstrap must bind authentication during composition");

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
        return issuer.mintSession({ principal, ...extra });
    }

    return {
        registry: capabilityRuntime.registry,
        registrars: capabilityRuntime.registrars,
        store, clock: c, rt,
        session,
        admit: rt.admit,
        evaluate: rt.evaluate,
        gate: rt,
        registerCapability, grantAuthority
    };
}

module.exports = { manualClock, makeHarness, defaultScopeResolver, authenticate, CLOCK_START };
