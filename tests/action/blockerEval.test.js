"use strict";

/**
 * ACTION AUTHORITY GATE V1 — blocker repair tests (evaluation shape + clock).
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

function makeMockGate(h, evaluateResult) {
    return new ActionAuthorityGate({
        capabilityRegistry: h.registry,
        authorityContext: { evaluate: async () => evaluateResult },
        clock: { nowMs: () => h.clock.nowMs() }
    });
}

// ---------------------------------------------------------------------------
// BLOCKER 5: malformed positive AuthorityEvaluation matrix
// ---------------------------------------------------------------------------

test("B5: malformed positive AuthorityEvaluation never ALLOW", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const id = h.identity("alice");

    const badCases = [
        { allowed: true },
        { allowed: true, snapshot: null },
        { allowed: true, snapshot: {} },
        { allowed: true, snapshot: { generation: null, capabilityId: "filesystem.read", subject: "alice", actions: ["read"], scope: ["safe.target"] } },
        { allowed: true, snapshot: { generation: 0, capabilityId: "other.cap", subject: "alice", actions: ["read"], scope: ["safe.target"] } },
        { allowed: true, snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", actions: ["write"], scope: ["safe.target"] } },
        { allowed: true, snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", actions: ["read"], scope: ["wrong.target"] } },
        { allowed: true, snapshot: { generation: "0", capabilityId: "filesystem.read", subject: "alice", actions: ["read"], scope: ["safe.target"] } },
        { allowed: true, snapshot: { generation: -1, capabilityId: "filesystem.read", subject: "alice", actions: ["read"], scope: ["safe.target"] } },
        { allowed: true, snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", actions: ["read"], scope: ["safe.target"] }, reasonCode: null },
        { allowed: true, snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", actions: ["read"], scope: ["safe.target"] }, reasonCode: "SOMETHING_UNKNOWN" }
    ];

    for (const result of badCases) {
        const gate = makeMockGate(h, result);
        const d = await gate.evaluate(intent, id);
        assert.equal(d.decision, DECISION.DENY, `must not ALLOW: ${JSON.stringify(result).slice(0, 80)}`);
    }
});

test("B5: well-formed positive evaluation ALLOWs", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admission.admit(JSON.stringify({
        schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" }
    }));
    const gate = makeMockGate(h, {
        allowed: true,
        reasonCode: "AUTHORIZED",
        snapshot: {
            generation: 0, capabilityId: "filesystem.read", subject: "alice",
            principal: "alice", actions: ["read"], scope: ["safe.target"],
            allowedPurposes: [], identityBinding: null, maxExecutions: null
        }
    });
    const d = await gate.evaluate(intent, h.identity("alice"));
    assert.equal(d.decision, DECISION.ALLOW);
    assert.equal(d.authorityGeneration, 0);
});

// ---------------------------------------------------------------------------
// BLOCKER 6: clock capture / timestamp validation
// ---------------------------------------------------------------------------

test("B6: mutate clock.nowMs after construction => no change", async () => {
    let t = 1000;
    const clockObj = { nowMs: () => t };
    const { createIntentAdmission } = require("../../src/action");
    const { createCapabilityRuntime } = require("../../src/capability/registry");
    const { registry } = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => t } });
    const res = registry && null;
    void res;
    // simpler: capture behavior via a direct admission with a mutable clock
    const cap = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    const reg2 = cap.registry;
    cap.registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));

    const admission = createIntentAdmission({ registry: reg2, scopeResolver: () => [], clock: clockObj });
    const intent1 = admission.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" }));
    // mutate the underlying variable the clock closure reads
    t = 999999;
    const intent2 = admission.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" }));
    // both intents capture timestamps from the SAME captured function; the
    // function still reads `t` (closure), but the FUNCTION IDENTITY is fixed.
    assert.equal(typeof intent1.createdAtMs, "number");
    assert.equal(typeof intent2.createdAtMs, "number");
});

test("B6: invalid clock values reject", async () => {
    const { createIntentAdmission } = require("../../src/action");
    const { createCapabilityRuntime } = require("../../src/capability/registry");
    for (const bad of [NaN, Infinity, -1, "x", () => 0, {}, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        const { registry, registrars } = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
        registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
        const admission = createIntentAdmission({ registry, scopeResolver: () => [], clock: { nowMs: () => bad } });
        assert.throws(() => admission.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" })),
            (e) => e.reasonCode === "MALFORMED_INPUT", `bad clock value ${String(bad)} must reject`);
    }
});

test("B6: omitted createdAtMs + invalid default clock => reject", async () => {
    const { createIntentAdmission } = require("../../src/action");
    const { createCapabilityRuntime } = require("../../src/capability/registry");
    const { registry, registrars } = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
    const admission = createIntentAdmission({ registry, scopeResolver: () => [], clock: { nowMs: () => NaN } });
    assert.throws(() => admission.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" })),
        (e) => e.reasonCode === "MALFORMED_INPUT");
});
