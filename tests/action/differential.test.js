"use strict";

/**
 * ACTION AUTHORITY GATE V1 — canonical Authority differential matrix.
 *
 * For >=1000 generated grant/request cases, compare the canonical evaluator
 * (used by AuthorityRegistry.authorize) against the Lane 2 gate's authority
 * outcome. The invariant is:
 *
 *   lane2AllowCanonicalDeny == 0
 *
 * i.e., there must be zero cases where Lane 2 ALLOWs while the canonical
 * evaluator denies.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { evaluateAuthorityReadOnly } = require("../../src/authority/evaluate");
const { ActionAuthorityGate, createReadOnlyAuthorityContext } = require("../../src/action");

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ACTIONS = ["read", "write", "delete"];
const SCOPES = ["safe.target", "unsafe.target", "scope=home-lan", "scope=cloud"];
const STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED", "EXHAUSTED"];
const PRINCIPALS = ["alice", "bob", "carol"];

async function runDifferential(seed) {
    const rng = mulberry32(seed);
    const { registry, registrars } = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    const store = createMemoryAuthorityStore();
    const context = createReadOnlyAuthorityContext(store, { clock: { nowMs: () => 1000 } });
    const gate = new ActionAuthorityGate({ capabilityRegistry: registry, authorityContext: context, clock: { nowMs: () => 1000 } });

    // register one capability available, declared ops read/write/delete
    const res = registrars.core.register(JSON.stringify({
        schemaVersion: 1, id: "cap.diff", kind: "system", provider: "core",
        operations: ["read", "write", "delete"], requirements: [], effects: []
    }));
    registry.observeAvailability("cap.diff", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });

    let lane2AllowCanonicalDeny = 0;
    let cases = 0;

    for (let i = 0; i < 1200; i++) {
        const action = ACTIONS[Math.floor(rng() * ACTIONS.length)];
        const scopeToken = SCOPES[Math.floor(rng() * SCOPES.length)];
        const status = STATUSES[Math.floor(rng() * STATUSES.length)];
        const grantScope = rng() < 0.5 ? [scopeToken] : [];
        const grantActions = rng() < 0.5 ? [action] : ["read", "write"];
        const principal = PRINCIPALS[Math.floor(rng() * PRINCIPALS.length)];
        const grantPrincipal = rng() < 0.5 ? principal : PRINCIPALS[Math.floor(rng() * PRINCIPALS.length)];
        const useIdentityBinding = rng() < 0.5;

        const grant = {
            capabilityId: "cap.diff", kind: "root", subject: "grant-holder",
            issuer: "diff", actions: grantActions, scope: grantScope, allowedPurposes: [],
            restrictions: null, maxExecutions: null, usedExecutions: 0,
            issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
            status, generation: 0, delegationDepth: 0, remainingDelegationDepth: 2,
            parentCapabilityId: null, rootCapabilityId: "cap.diff", ratificationId: null,
            identityBinding: useIdentityBinding ? { principals: [grantPrincipal] } : null,
            extra: null
        };
        await store.upsertCapability("cap.diff", status, 0, JSON.stringify(grant));

        const request = {
            capabilityId: "cap.diff",
            action,
            scope: rng() < 0.5 ? [scopeToken] : [],
            identity: { principal }
        };

        const canonical = await evaluateAuthorityReadOnly(store, request, { nowMs: 1000 });

        // Lane 2 gate path: build a canonical intent bound to the incarnation and
        // scope, then evaluate with the trusted identity.
        const intent = {
            schemaVersion: 1, intentId: `int-${i}`, capabilityId: "cap.diff",
            capabilityIncarnationId: res.incarnationId, operation: action,
            arguments: {}, scope: request.scope, correlationId: "", metadata: {},
            createdAtMs: 1000
        };
        const lane2 = await gate.evaluate(intent, { principal, sessionId: "", channel: "" });

        if (canonical.allowed === true && lane2.decision !== "ALLOW") {
            // canonical allows but lane2 denies: acceptable? The gate is stricter
            // (e.g., incarnation/availability), but for this matrix availability is
            // AVAILABLE and incarnation matches, so they should agree on ALLOW.
            // We only require zero lane2-ALLOW-when-canonical-DENY.
        }
        if (canonical.allowed !== true && lane2.decision === "ALLOW") {
            lane2AllowCanonicalDeny++;
        }
        cases++;
    }

    return { lane2AllowCanonicalDeny, cases };
}

test("differential: >=1000 cases, lane2AllowCanonicalDeny == 0", async () => {
    const r = await runDifferential(20260828);
    assert.ok(r.cases >= 1000);
    assert.equal(r.lane2AllowCanonicalDeny, 0, "Lane 2 must never ALLOW when canonical Authority denies");
});
