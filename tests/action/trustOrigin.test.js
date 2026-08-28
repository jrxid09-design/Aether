"use strict";

/**
 * ACTION AUTHORITY GATE V1 — runtime-local trust-domain tests.
 *
 * Proves:
 *   - VALID SHAPE != TRUSTED ORIGIN
 *   - VALID ORIGIN IN RUNTIME A != TRUSTED IN RUNTIME B
 *   - the public/direct surface exposes no issuer minting and no gate
 *     construction
 *   - a caller cannot mint a session trusted by ANY canonical runtime except
 *     through a runtime's own bootstrap-held issuer
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createActionAuthorityRuntime, DECISION, isCanonicalAuthorityEvaluation } = require("../../src/action");
const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { makeHarness, authenticate } = require("./helpers");

const CLOCK = { nowMs: () => 1000 };

async function setupAvailable(h, id = "filesystem.read", ops = ["read"]) {
    const res = await h.registerCapability({ id, operations: ops });
    await h.registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

/** Build a minimal standalone runtime + bootstrap-held issuer (for
 *  cross-runtime replay tests). */
async function makeRuntime({ nowMs = () => 1000 } = {}) {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs } });
    const { registry, registrars } = capabilityRuntime;
    const store = createMemoryAuthorityStore();
    let issuer = null;
    const rt = createActionAuthorityRuntime({
        capabilityRuntime,
        authorityStore: store,
        trustedScopeBindings: { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } },
        clock: { nowMs },
        onReady: ({ bindAuthentication }) => {
            issuer = bindAuthentication({ authenticate });
        }
    });
    const res = registrars.core.register(JSON.stringify({
        schemaVersion: 1, id: "cap.x", kind: "system", provider: "core",
        operations: ["read"], requirements: [], effects: []
    }));
    registry.observeAvailability("cap.x", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    await store.upsertCapability("cap.x", "ACTIVE", 0, JSON.stringify({
        capabilityId: "cap.x", kind: "root", subject: "alice", issuer: "test",
        actions: ["read"], scope: [], allowedPurposes: [],
        restrictions: { kind: "unrestricted" }, maxExecutions: null, usedExecutions: 0,
        issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
        status: "ACTIVE", generation: 0, delegationDepth: 0, remainingDelegationDepth: 2,
        parentCapabilityId: null, rootCapabilityId: "cap.x", ratificationId: null,
        identityBinding: { principals: ["alice"] }, extra: null
    }));
    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.x", operation: "read", arguments: { target: "safe.target" } }));
    return { registry, registrars, store, rt, issuer, intent };
}

test("trust-origin: runtime surface is exactly { admit, evaluate } — no identity minting", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    assert.equal(typeof h.rt.issueIdentity, "undefined", "no issueIdentity surface");
    assert.equal(typeof h.rt.mintSession, "undefined", "no mintSession surface");
    assert.equal(typeof h.rt.issueSession, "undefined", "no issueSession surface");
    assert.equal(typeof h.rt.bindAuthentication, "undefined", "no bindAuthentication on runtime surface");
    assert.deepEqual(Object.keys(h.rt).sort(), ["admit", "evaluate"].sort());
});

test("trust-origin: bindAuthentication is one-time; second bind throws", async () => {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const store = createMemoryAuthorityStore();
    let bindFn = null;
    let firstIssuer = null;
    createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: {},
        clock: CLOCK,
        onReady: ({ bindAuthentication }) => {
            bindFn = bindAuthentication;
            firstIssuer = bindAuthentication({ authenticate });
        }
    });
    assert.ok(typeof firstIssuer.mintSession === "function");
    assert.throws(() => bindFn({ authenticate }), (e) => e.reasonCode === "INVALID_DECISION_STATE",
        "second bindAuthentication must throw");
});

test("trust-origin: without binding authentication, no session can exist and evaluate fails closed", async () => {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const { registry, registrars } = capabilityRuntime;
    const store = createMemoryAuthorityStore();
    const rt = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: { "cap.x": { read: () => [] } },
        clock: CLOCK
    });
    const res = registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "cap.x", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
    registry.observeAvailability("cap.x", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.x", operation: "read" }));
    const d = await rt.evaluate(intent, { principal: "alice", sessionId: "", channel: "" });
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

test("trust-origin: public surface no longer exports createAuthSessionIssuer", () => {
    const api = require("../../src/action");
    assert.equal(typeof api.createAuthSessionIssuer, "undefined",
        "createAuthSessionIssuer must not be publicly importable");
});

test("trust-origin: caller cannot mint a session trusted by any canonical runtime", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    // The attacker holds NO issuer for this runtime domain: the issuer was
    // captured by bootstrap during composition and never placed on rt. Every
    // fake/lookalike session is DENY INVALID_IDENTITY.
    const lookalikes = [
        { principal: "victim", sessionId: "", channel: "" },
        Object.freeze({ principal: "victim", sessionId: "", channel: "" }),
        JSON.parse(JSON.stringify({ principal: "victim", sessionId: "", channel: "" })),
        { principal: "victim", sessionId: "", channel: "", [Symbol("aether.action.authSession.brand")]: true }
    ];
    for (const candidate of lookalikes) {
        const d = await h.evaluate(intent, candidate);
        assert.equal(d.decision, DECISION.DENY);
        assert.equal(d.reasonCode, "INVALID_IDENTITY");
    }
    // Only bootstrap-held issuer sessions are trusted.
    const d = await h.evaluate(intent, h.session("victim"));
    assert.equal(d.decision, DECISION.ALLOW);
});

test("trust-origin: cross-runtime session replay A -> B rejected; B -> A rejected", async () => {
    const A = await makeRuntime();
    const B = await makeRuntime();

    const sessionA = A.issuer.mintSession({ principal: "alice" });
    const sessionB = B.issuer.mintSession({ principal: "alice" });

    // 1. A session -> A accepted
    assert.equal((await A.rt.evaluate(A.intent, sessionA)).decision, DECISION.ALLOW);
    // 2. A session -> B rejected
    const ab = await B.rt.evaluate(B.intent, sessionA);
    assert.equal(ab.decision, DECISION.DENY, "runtime A session must be rejected by runtime B");
    assert.equal(ab.reasonCode, "INVALID_IDENTITY");
    // 3. B session -> A rejected
    const ba = await A.rt.evaluate(A.intent, sessionB);
    assert.equal(ba.decision, DECISION.DENY, "runtime B session must be rejected by runtime A");
    assert.equal(ba.reasonCode, "INVALID_IDENTITY");
    // 4. B session -> B accepted
    assert.equal((await B.rt.evaluate(B.intent, sessionB)).decision, DECISION.ALLOW);
});

test("trust-origin: shared canonical state does NOT federate session trust (attacker runtime over A's registry+store)", async () => {
    // An attacker who composes a NEW runtime over the SAME canonical registry +
    // authority store still cannot replay a victim session: the new runtime
    // mints its OWN session brand, and the victim's session is not in it. And
    // the attacker's own "victim" session does not work on runtime A.
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const { registry, registrars } = capabilityRuntime;
    const store = createMemoryAuthorityStore();
    const res = registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "cap.x", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
    registry.observeAvailability("cap.x", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    await store.upsertCapability("cap.x", "ACTIVE", 0, JSON.stringify({
        capabilityId: "cap.x", kind: "root", subject: "victim", issuer: "test",
        actions: ["read"], scope: [], allowedPurposes: [],
        restrictions: { kind: "unrestricted" }, maxExecutions: null, usedExecutions: 0,
        issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
        status: "ACTIVE", generation: 0, delegationDepth: 0, remainingDelegationDepth: 2,
        parentCapabilityId: null, rootCapabilityId: "cap.x", ratificationId: null,
        identityBinding: { principals: ["victim"] }, extra: null
    }));

    let issuerA = null;
    const A = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } },
        clock: CLOCK,
        onReady: ({ bindAuthentication }) => { issuerA = bindAuthentication({ authenticate }); }
    });
    let issuerAtk = null;
    const attackerRuntime = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store,
        trustedScopeBindings: { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } },
        clock: CLOCK,
        onReady: ({ bindAuthentication }) => { issuerAtk = bindAuthentication({ authenticate }); }
    });

    const victimSession = issuerA.mintSession({ principal: "victim" });
    const attackerIntent = attackerRuntime.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.x", operation: "read", arguments: { target: "safe.target" } }));

    const d = await attackerRuntime.evaluate(attackerIntent, victimSession);
    assert.equal(d.decision, DECISION.DENY, "victim session must not be replayable on a new runtime over shared state");
    assert.equal(d.reasonCode, "INVALID_IDENTITY");

    const forged = issuerAtk.mintSession({ principal: "victim" });
    const aIntent = A.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.x", operation: "read", arguments: { target: "safe.target" } }));
    const d2 = await A.evaluate(aIntent, forged);
    assert.equal(d2.decision, DECISION.DENY, "runtime B session must be rejected by runtime A even over shared canonical state");
    assert.equal(d2.reasonCode, "INVALID_IDENTITY");
});

test("trust-origin: identity from authenticated trusted session works; fake session object fails", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    // legit branded session from THIS runtime's bootstrap issuer
    const legit = h.session("alice");
    assert.equal((await h.evaluate(intent, legit)).decision, DECISION.ALLOW);

    // fake plain-object session (unbranded)
    const fake = { principal: "alice", sessionId: "", channel: "" };
    const d = await h.evaluate(intent, fake);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

test("trust-origin: cloned/frozen/session-shaped objects fail", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    const legit = h.session("alice");
    const frozenClone = Object.freeze({ ...legit });
    const structural = { principal: "alice", sessionId: "", channel: "" };
    const jsonRound = JSON.parse(JSON.stringify(legit));

    for (const candidate of [frozenClone, structural, jsonRound]) {
        const d = await h.evaluate(intent, candidate);
        assert.equal(d.decision, DECISION.DENY, "clone/JSON session must be rejected");
        assert.equal(d.reasonCode, "INVALID_IDENTITY");
    }

    // legit still works
    assert.equal((await h.evaluate(intent, legit)).decision, DECISION.ALLOW);
});

test("trust-origin: fake Symbol/token cannot self-issue a session", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    const fakeSymbolObj = { principal: "victim", sessionId: "", channel: "", [Symbol("aether.action.authSession.brand")]: true };
    const d = await h.evaluate(intent, fakeSymbolObj);
    assert.equal(d.decision, DECISION.DENY, "Symbol-branded lookalike rejected");
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

test("trust-origin: evaluator/verifier are sealed (no replacement, no prototype tampering)", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const id = h.session("alice");

    // frozen surface: no reassignment of evaluate.
    assert.ok(Object.isFrozen(h.rt));
    assert.throws(() => { h.rt.evaluate = () => ({ decision: DECISION.ALLOW }); });
    // defineProperty replacement also fails on a frozen object.
    assert.throws(() => Object.defineProperty(h.rt, "evaluate", { value: () => ({ decision: DECISION.ALLOW }) }));

    // No prototype on the runtime surface to tamper with (it is a frozen plain object).
    const d = await h.evaluate(intent, id);
    assert.equal(d.decision, DECISION.DENY, "canonical behavior unchanged after tamper attempts");
});

test("trust-origin: scope-binding outer/nested mutation has zero effect", async () => {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const res = capabilityRuntime.registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "x.one", kind: "system", provider: "core", operations: ["read"], requirements: [], effects: [] }));
    capabilityRuntime.registry.observeAvailability("x.one", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    const store = createMemoryAuthorityStore();

    const bindings = { "x.one": { read: (a) => (a && a.target ? [a.target] : []) } };
    const rt = createActionAuthorityRuntime({ capabilityRuntime, authorityStore: store, trustedScopeBindings: bindings, clock: CLOCK });

    // mutate the outer binding object and nested resolver AFTER composition
    bindings["x.one"] = { read: () => ["MALICIOUS.SCOPE"] };
    bindings["x.one"].read = () => ["MALICIOUS.SCOPE"];
    delete bindings["x.one"];

    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "x.one", operation: "read", arguments: { target: "safe.target" } }));
    assert.deepEqual(intent.scope, ["safe.target"], "captured resolver still used; caller mutation has no effect");
});

test("trust-origin: hostile Proxy identity rejection executes zero traps", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));

    let traps = 0;
    const hostile = new Proxy({}, {
        get(o, p) { traps++; return o[p]; },
        getPrototypeOf() { traps++; return Object.prototype; },
        ownKeys() { traps++; return []; },
        getOwnPropertyDescriptor() { traps++; return undefined; },
        has() { traps++; return false; },
        set() { traps++; return false; }
    });
    const d = await h.evaluate(intent, hostile);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(traps, 0, "no Proxy trap may execute during rejection or after");
});

test("trust-origin: fake authorityContext / copied canonical-looking evaluation rejected", async () => {
    const plainEval = {
        allowed: true, reasonCode: "AUTHORIZED",
        snapshot: { generation: 0, capabilityId: "filesystem.read", subject: "alice", principal: "alice", actions: ["read"], scope: ["safe.target"], allowedPurposes: [], identityBinding: null, maxExecutions: null }
    };
    assert.equal(isCanonicalAuthorityEvaluation(plainEval), false, "copied evaluation not canonical");
    assert.equal(isCanonicalAuthorityEvaluation(JSON.parse(JSON.stringify(plainEval))), false, "cloned evaluation not canonical");
});
