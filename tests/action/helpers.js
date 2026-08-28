"use strict";

/** Shared helpers for action intent + authority gate tests (sealed runtime). */

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { createActionAuthorityRuntime, createAuthSessionIssuer } = require("../../src/action");

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

/**
 * Build a full trusted harness:
 *   { registry, registrars, store, clock, rt, session, registerCapability, grantAuthority }
 *
 * `rt` is the trusted runtime surface: { admit, evaluate }.
 * `session(principal, extra)` mints a branded AuthSessionCapability.
 */
async function makeHarness({ clock, scopeBindings } = {}) {
    const c = clock ?? manualClock();
    const capabilityRuntime = createCapabilityRuntime({
        registrars: { core: true },
        clock: { nowMs: () => c.nowMs() }
    });
    const store = createMemoryAuthorityStore();
    const authSessionIssuer = createAuthSessionIssuer();

    const bindings = scopeBindings ?? {
        "filesystem.read": { read: defaultScopeResolver, write: defaultScopeResolver },
        "filesystem.write": { write: defaultScopeResolver }
    };

    const rt = createActionAuthorityRuntime({
        capabilityRuntime,
        authorityStore: store,
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
        return authSessionIssuer.mintSession({ principal, ...extra });
    }

    return {
        registry: capabilityRuntime.registry,
        registrars: capabilityRuntime.registrars,
        store, clock: c, rt,
        authSessionIssuer,
        session,
        admit: rt.admit,
        evaluate: rt.evaluate,
        gate: rt,
        registerCapability, grantAuthority
    };
}

module.exports = { manualClock, makeHarness, defaultScopeResolver, CLOCK_START };
