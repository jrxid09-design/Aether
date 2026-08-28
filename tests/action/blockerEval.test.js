"use strict";

/**
 * ACTION AUTHORITY GATE V1 — blocker repair tests (evaluation branding + clock).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseActionIntent, ActionAuthorityGate, DECISION, createActionAuthorityRuntime, isCanonicalAuthorityEvaluation } = require("../../src/action");
const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { makeHarness } = require("./helpers");

async function setupAvailable(h, id = "filesystem.read", ops = ["read"]) {
    const res = await h.registerCapability({ id, operations: ops });
    await h.registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

// ---------------------------------------------------------------------------
// BLOCKER 5: positive evaluation must be BRANDED (trust origin), not shape-only
// ---------------------------------------------------------------------------

test("B5: fake evaluate() returning perfect-looking ALLOW cannot be wired into canonical gate", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const id = h.issueIdentity({ principal: "alice" });

    // A fake evaluator returning a perfect-looking ALLOW snapshot (un-branded).
    const fakeGate = new ActionAuthorityGate({
        capabilityRegistry: h.registry,
        authorityEvaluator: async () => ({
            allowed: true,
            reasonCode: "AUTHORIZED",
            snapshot: {
                generation: 0, capabilityId: "filesystem.read", subject: "alice",
                principal: "alice", actions: ["read"], scope: ["safe.target"],
                allowedPurposes: [], identityBinding: null, maxExecutions: null
            }
        }),
        isCanonicalEvaluation: isCanonicalAuthorityEvaluation,
        clock: { nowMs: () => h.clock.nowMs() }
    });
    const d = await fakeGate.evaluate(intent, id);
    assert.equal(d.decision, DECISION.DENY, "un-branded positive evaluation must never ALLOW");
    assert.equal(d.reasonCode, "MALFORMED_AUTHORITY_EVALUATION");
});

test("B5: copied/plain canonical-looking AuthorityEvaluation cannot manufacture ALLOW", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const id = h.issueIdentity({ principal: "alice" });

    // A hand-crafted object that LOOKS canonical but carries no brand.
    const plainEval = {
        allowed: true,
        reasonCode: "AUTHORIZED",
        snapshot: {
            generation: 0, capabilityId: "filesystem.read", subject: "alice",
            principal: "alice", actions: ["read"], scope: ["safe.target"],
            allowedPurposes: [], identityBinding: null, maxExecutions: null
        }
    };
    assert.equal(isCanonicalAuthorityEvaluation(plainEval), false, "plain object must not be a canonical evaluation");

    const fakeGate = new ActionAuthorityGate({
        capabilityRegistry: h.registry,
        authorityEvaluator: async () => plainEval,
        isCanonicalEvaluation: isCanonicalAuthorityEvaluation,
        clock: { nowMs: () => h.clock.nowMs() }
    });
    assert.equal((await fakeGate.evaluate(intent, id)).decision, DECISION.DENY);
});

test("B5: canonical evaluator output is accepted (branded)", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"] });
    const intent = h.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const d = await h.gate.evaluate(intent, h.issueIdentity({ principal: "alice" }));
    assert.equal(d.decision, DECISION.ALLOW);
});

// ---------------------------------------------------------------------------
// BLOCKER 6: clock capture / timestamp validation
// ---------------------------------------------------------------------------

test("B6: invalid clock values reject at runtime construction / admission", async () => {
    for (const bad of [NaN, Infinity, -1, "x", () => 0, {}, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
        capabilityRuntime.registrars.core.register(JSON.stringify({
            schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: []
        }));
        const store = createMemoryAuthorityStore();
        const rt = createActionAuthorityRuntime({
            capabilityRuntime, authorityStore: store,
            trustedScopeBindings: { "x.one": { read: () => [] } },
            clock: { nowMs: () => bad }
        });
        assert.throws(() => rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" })),
            (e) => e.reasonCode === "MALFORMED_INPUT", `bad clock value ${String(bad)} must reject`);
    }
});

test("B6: omitted createdAtMs + invalid default clock => reject", async () => {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    capabilityRuntime.registrars.core.register(JSON.stringify({
        schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: []
    }));
    const store = createMemoryAuthorityStore();
    const rt = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: { "x.one": { read: () => [] } },
        clock: { nowMs: () => NaN }
    });
    assert.throws(() => rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" })),
        (e) => e.reasonCode === "MALFORMED_INPUT");
});
