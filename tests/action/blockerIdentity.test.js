"use strict";

/**
 * ACTION AUTHORITY GATE V1 — blocker repair tests (identity/scope/incarnation).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseActionIntent, ActionAuthorityGate, DECISION } = require("../../src/action");
const { makeHarness } = require("./helpers");

async function setupAvailable(h, id = "filesystem.read", ops = ["read"]) {
    const res = await h.registerCapability({ id, operations: ops });
    await h.registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

// ---------------------------------------------------------------------------
// BLOCKER 1: identity / channel / session spoof
// ---------------------------------------------------------------------------

test("B1: intent cannot carry subject; identity comes from runtime context", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    // Grant bound to principal "victim" via identityBinding (canonical mechanism).
    await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });

    assert.throws(() => parseActionIntent(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", subject: "victim"
    })), (e) => e.reasonCode === "AUTHORITY_METADATA" || e.reasonCode === "UNKNOWN_FIELD");

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));

    const d = await h.gate.evaluate(intent, h.identity("attacker"));
    assert.equal(d.decision, DECISION.DENY);

    const d2 = await h.gate.evaluate(intent, h.identity("victim"));
    assert.equal(d2.decision, DECISION.ALLOW);
});

test("B1: intent channel cannot become console identity", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { channels: ["console"] } });

    assert.throws(() => parseActionIntent(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", channel: "console"
    })), (e) => e.reasonCode === "AUTHORITY_METADATA" || e.reasonCode === "UNKNOWN_FIELD");

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));

    assert.equal((await h.gate.evaluate(intent, h.identity("alice", { channel: "console" }))).decision, DECISION.ALLOW);
    assert.equal((await h.gate.evaluate(intent, h.identity("alice", { channel: "telegram" }))).decision, DECISION.DENY);
});

test("B1: spoofed session ID cannot bind another session grant", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { sessionIds: ["sess-a"] } });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));

    assert.equal((await h.gate.evaluate(intent, h.identity("alice", { sessionId: "sess-a" }))).decision, DECISION.ALLOW);
    assert.equal((await h.gate.evaluate(intent, h.identity("alice", { sessionId: "sess-b" }))).decision, DECISION.DENY);
});

test("B1: changing descriptive channel must not change authority", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"] });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));

    assert.equal((await h.gate.evaluate(intent, h.identity("alice", { channel: "console" }))).decision, DECISION.ALLOW);
    assert.equal((await h.gate.evaluate(intent, h.identity("alice", { channel: "telegram" }))).decision, DECISION.ALLOW);
});

test("B1: no trusted runtime identity context => fail closed", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"] });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));

    const d = await h.gate.evaluate(intent, null);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// BLOCKER 2: scope binding
// ---------------------------------------------------------------------------

test("B2: grant safe.target + intent unsafe.target => DENY", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], scope: ["safe.target"] });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "unsafe.target" }
    }));
    const d = await h.gate.evaluate(intent, h.identity("alice"));
    assert.equal(d.decision, DECISION.DENY);
});

test("B2: exact bound target succeeds when Authority permits", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], scope: ["safe.target"] });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    assert.equal((await h.gate.evaluate(intent, h.identity("alice"))).decision, DECISION.ALLOW);
});

test("B2: empty/unresolved scope cannot satisfy scoped grant", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], scope: ["safe.target"] });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read"
    }));
    assert.equal((await h.gate.evaluate(intent, h.identity("alice"))).decision, DECISION.DENY);
});

test("B2: caller cannot supply arbitrary scope string to broaden authority", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], scope: ["safe.target"] });

    assert.throws(() => parseActionIntent(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", scope: ["any.target"]
    })), (e) => e.reasonCode === "AUTHORITY_METADATA" || e.reasonCode === "UNKNOWN_FIELD");
});

test("B2: scope binding survives unchanged into Authority evaluation", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], scope: ["safe.target"] });

    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    assert.deepEqual(intent.scope, ["safe.target"]);
    assert.equal((await h.gate.evaluate(intent, h.identity("alice"))).decision, DECISION.ALLOW);
});

// ---------------------------------------------------------------------------
// BLOCKER 3: store read-failure matrix (fail closed)
// ---------------------------------------------------------------------------

test("B3: getCapability/getGeneration/countConsumption throws => no ALLOW", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const id = h.issueIdentity({ principal: "alice" });

    const stores = [
        { getCapability: async () => { throw new Error("db"); }, getGeneration: async () => 0, countConsumption: async () => 0 },
        { getCapability: async () => ({ status: "ACTIVE", generation: 0, payload: { capabilityId: "filesystem.read", kind: "root", subject: "alice", actions: ["read"], scope: [], allowedPurposes: [], restrictions: { kind: "unrestricted" }, maxExecutions: null, issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null } }), getGeneration: async () => { throw new Error("db"); }, countConsumption: async () => 0 },
        { getCapability: async () => ({ status: "ACTIVE", generation: 0, payload: { capabilityId: "filesystem.read", kind: "root", subject: "alice", actions: ["read"], scope: [], allowedPurposes: [], restrictions: { kind: "unrestricted" }, maxExecutions: 5, issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null } }), getGeneration: async () => 0, countConsumption: async () => { throw new Error("db"); } }
    ];

    for (const badStore of stores) {
        const { createCapabilityRuntime } = require("../../src/capability/registry");
        const { createActionAuthorityRuntime } = require("../../src/action");
        const capRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => h.clock.nowMs() } });
        const res = capRuntime.registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "filesystem.read", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
        capRuntime.registry.observeAvailability("filesystem.read", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
        const rt = createActionAuthorityRuntime({
            capabilityRuntime: capRuntime, authorityStore: badStore,
            trustedScopeBindings: { "filesystem.read": { read: (a) => a && a.target ? [a.target] : [] } },
            clock: { nowMs: () => h.clock.nowMs() }
        });
        const d = await rt.gate.evaluate(intent, id);
        assert.equal(d.decision, DECISION.DENY, "store read failure must fail closed");
    }
});

test("B3: malformed grant => no ALLOW", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const badStore = { getCapability: async () => ({ status: "ACTIVE", generation: 0, payload: null }), getGeneration: async () => 0, countConsumption: async () => 0 };
    const { createCapabilityRuntime } = require("../../src/capability/registry");
    const { createActionAuthorityRuntime } = require("../../src/action");
    const capRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => h.clock.nowMs() } });
    const res = capRuntime.registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "filesystem.read", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
    capRuntime.registry.observeAvailability("filesystem.read", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    const rt = createActionAuthorityRuntime({
        capabilityRuntime: capRuntime, authorityStore: badStore,
        trustedScopeBindings: { "filesystem.read": { read: (a) => a && a.target ? [a.target] : [] } },
        clock: { nowMs: () => h.clock.nowMs() }
    });
    assert.equal((await rt.gate.evaluate(intent, h.issueIdentity({ principal: "alice" }))).decision, DECISION.DENY);
});

// ---------------------------------------------------------------------------
// BLOCKER 4: incarnation A -> B stale intent
// ---------------------------------------------------------------------------

test("B4: incarnation A -> B stale intent never ALLOW", async () => {
    const h = await makeHarness();
    const resA = await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"] });

    const intentA = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    assert.equal(intentA.capabilityIncarnationId, resA.incarnationId);
    assert.equal((await h.gate.evaluate(intentA, h.identity("alice"))).decision, DECISION.ALLOW);

    await h.registry.remove("filesystem.read");
    const resB = await setupAvailable(h);
    assert.notEqual(resB.incarnationId, resA.incarnationId);

    const dB = await h.gate.evaluate(intentA, h.identity("alice"));
    assert.equal(dB.decision, DECISION.DENY);
    assert.equal(dB.reasonCode, "CAPABILITY_INCARNATION_MISMATCH");
});
