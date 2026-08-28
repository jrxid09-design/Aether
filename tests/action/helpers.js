"use strict";

/** Shared helpers for action intent + authority gate tests (post-repair). */

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const {
    createIntentAdmission, createRuntimeIdentityContext,
    ActionAuthorityGate, createReadOnlyAuthorityContext
} = require("../../src/action");

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

/** Default deterministic scope resolver: scope token derived from arguments.target. */
function defaultScopeResolver(capabilityId, operation, args) {
    const target = args && typeof args.target === "string" ? args.target.trim().toLowerCase() : "";
    return target ? [target] : [];
}

/**
 * Build a full test harness:
 *   { registry, registrars, store, clock, gate, context, admit, identity,
 *     registerCapability, grantAuthority }
 */
async function makeHarness({ clock, scopeResolver } = {}) {
    const c = clock ?? manualClock();
    const { registry, registrars } = createCapabilityRuntime({
        registrars: { core: true },
        clock: { nowMs: () => c.nowMs() }
    });
    const store = createMemoryAuthorityStore();
    const context = createReadOnlyAuthorityContext(store, { clock: { nowMs: () => c.nowMs() } });
    const gate = new ActionAuthorityGate({
        capabilityRegistry: registry,
        authorityContext: context,
        clock: { nowMs: () => c.nowMs() }
    });
    const resolver = scopeResolver ?? defaultScopeResolver;
    const admission = createIntentAdmission({
        registry,
        scopeResolver: resolver,
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
        return registrars.core.register(JSON.stringify(descriptor));
    }

    async function grantAuthority({ capabilityId = "filesystem.read", subject = "alice", actions = ["read"], scope = [], generation = 0, identityBinding = null } = {}) {
        const grant = {
            capabilityId, kind: "root", subject,
            issuer: "owner-ratification:test",
            actions, scope, allowedPurposes: [],
            restrictions: null, maxExecutions: null, usedExecutions: 0,
            issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
            status: "ACTIVE", generation, delegationDepth: 0, remainingDelegationDepth: 2,
            parentCapabilityId: null, rootCapabilityId: capabilityId, ratificationId: null,
            identityBinding, extra: null
        };
        await store.upsertCapability(capabilityId, "ACTIVE", generation, JSON.stringify(grant));
    }

    function identity(principal = "alice", extra = {}) {
        return createRuntimeIdentityContext({ principal, ...extra });
    }

    return {
        registry, registrars, store, clock: c, gate, context,
        admission, identity, registerCapability, grantAuthority
    };
}

module.exports = { manualClock, makeHarness, defaultScopeResolver, CLOCK_START };
