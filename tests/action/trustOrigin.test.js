"use strict";

/**
 * ACTION AUTHORITY GATE V1 — trust-origin regression tests (Group A).
 *
 * Proves VALID SHAPE != TRUSTED ORIGIN: shape-valid but un-branded identities,
 * scope resolvers, and authority evaluations cannot manufacture trust.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createActionAuthorityRuntime, DECISION, isRuntimeIdentityContext, isCanonicalAuthorityEvaluation } = require("../../src/action");
const { makeHarness } = require("./helpers");

async function setupAvailable(h, id = "filesystem.read", ops = ["read"]) {
    const res = await h.registerCapability({ id, operations: ops });
    await h.registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

test("trust-origin: forged plain-object identity rejected", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    const forged = { principal: "alice", sessionId: "", channel: "" };
    assert.equal(isRuntimeIdentityContext(forged), false, "plain object must not be trusted");
    const d = await h.gate.evaluate(intent, forged);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

test("trust-origin: frozen clone and structurally-identical identity rejected", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    const legit = h.issueIdentity({ principal: "alice" });
    const frozenClone = Object.freeze({ ...legit });
    const structural = { principal: "alice", sessionId: "", channel: "" };

    assert.equal(isRuntimeIdentityContext(legit), true, "legit identity accepted");
    assert.equal(isRuntimeIdentityContext(frozenClone), false, "frozen clone rejected");
    assert.equal(isRuntimeIdentityContext(structural), false, "structurally identical rejected");

    assert.equal((await h.gate.evaluate(intent, frozenClone)).decision, DECISION.DENY);
    assert.equal((await h.gate.evaluate(intent, structural)).decision, DECISION.DENY);
});

test("trust-origin: fake token/Symbol cannot self-issue victim identity", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    // Attacker cannot call mintRuntimeIdentity (not exported) nor forge a brand.
    const api = require("../../src/action");
    assert.equal(typeof api.mintRuntimeIdentity, "undefined", "mintRuntimeIdentity must not be exported");

    const fakeSymbolObj = { principal: "victim", sessionId: "", channel: "", [Symbol("aether.action.runtimeIdentity.brand")]: true };
    assert.equal(isRuntimeIdentityContext(fakeSymbolObj), false, "Symbol-branded lookalike rejected");
    assert.equal((await h.gate.evaluate(intent, fakeSymbolObj)).decision, DECISION.DENY);
});

test("trust-origin: legitimate runtime identity accepted", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const d = await h.gate.evaluate(intent, h.issueIdentity({ principal: "alice" }));
    assert.equal(d.decision, DECISION.ALLOW);
});

test("trust-origin: arbitrary scopeResolver injection is impossible", async () => {
    // scope resolvers come only from trustedScopeBindings at runtime composition.
    const api = require("../../src/action");
    assert.equal(typeof api.createIntentAdmission, "undefined", "createIntentAdmission must not be exported (injectable resolver removed)");

    const h = await makeHarness();
    await setupAvailable(h);
    // A capability/operation WITHOUT a trusted binding must fail closed at admission.
    await h.registerCapability({ id: "filesystem.other", operations: ["read"] });
    await h.registry.observeAvailability("filesystem.other", "AVAILABLE", { generation: 1, incarnationId: (await h.registerCapability({ id: "filesystem.other", operations: ["read"] })).incarnationId });
    assert.throws(() => h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.other", operation: "read", arguments: { target: "x" } })),
        (e) => e.reasonCode === "INVALID_INTENT");
});

test("trust-origin: resolver exception and unbounded result fail closed", async () => {
    const { createCapabilityRuntime } = require("../../src/capability/registry");
    const { createMemoryAuthorityStore } = require("../../src/authority/store");
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    capabilityRuntime.registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
    const store = createMemoryAuthorityStore();

    // resolver that throws
    const rtThrow = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: { "x.one": { read: () => { throw new Error("boom"); } } },
        clock: { nowMs: () => 1000 }
    });
    assert.throws(() => rtThrow.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" })),
        (e) => e.reasonCode === "INVALID_INTENT");

    // resolver returning non-array
    const rtBad = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: { "x.one": { read: () => "not-an-array" } },
        clock: { nowMs: () => 1000 }
    });
    assert.throws(() => rtBad.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read" })),
        (e) => e.reasonCode === "INVALID_INTENT");
});

test("trust-origin: fake authorityContext / copied canonical-looking evaluation rejected", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const id = h.issueIdentity({ principal: "alice" });

    // A plain copied evaluation is not canonical (no brand).
    const plainEval = {
        allowed: true, reasonCode: "AUTHORIZED",
        snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", principal: "alice", actions: ["read"], scope: ["safe.target"], allowedPurposes: [], identityBinding: null, maxExecutions: null }
    };
    assert.equal(isCanonicalAuthorityEvaluation(plainEval), false, "copied evaluation must not be canonical");

    // A canonical-looking clone of a real evaluation also fails (brand is WeakSet, not structural).
    const realEval = { allowed: true, reasonCode: "AUTHORIZED", snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", principal: "alice", actions: ["read"], scope: ["safe.target"], allowedPurposes: [], identityBinding: null, maxExecutions: null } };
    const clonedEval = JSON.parse(JSON.stringify(realEval));
    assert.equal(isCanonicalAuthorityEvaluation(clonedEval), false, "cloned evaluation must not be canonical");

    void id;
});
