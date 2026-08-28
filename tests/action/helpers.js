"use strict";

/** Shared helpers for action intent + authority gate tests. */

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { parseActionIntent, ActionAuthorityGate, createReadOnlyAuthorityContext } = require("../../src/action");

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

/**
 * Build a full test harness:
 *   { registry, registrars, store, clock, gate, context, registerCapability, grantAuthority }
 */
async function makeHarness({ clock } = {}) {
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

    async function grantAuthority({ capabilityId = "filesystem.read", subject = "actor.1", actions = ["read"], generation = 0 } = {}) {
        const grant = {
            capabilityId, kind: "root", subject,
            issuer: "owner-ratification:test",
            actions, scope: [], allowedPurposes: [],
            restrictions: null, maxExecutions: null, usedExecutions: 0,
            issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
            status: "ACTIVE", generation, delegationDepth: 0, remainingDelegationDepth: 2,
            parentCapabilityId: null, rootCapabilityId: capabilityId, ratificationId: null, extra: null
        };
        await store.upsertCapability(capabilityId, "ACTIVE", generation, JSON.stringify(grant));
    }

    function intent(capabilityId = "filesystem.read", operation = "read", extra = {}) {
        return parseActionIntent(JSON.stringify({
            schemaVersion: 1,
            capabilityId,
            operation,
            subject: "actor.1",
            ...extra
        }), { nowMs: c.nowMs() });
    }

    return { registry, registrars, store, clock: c, gate, context, registerCapability, grantAuthority, intent };
}

module.exports = { manualClock, makeHarness, CLOCK_START };
