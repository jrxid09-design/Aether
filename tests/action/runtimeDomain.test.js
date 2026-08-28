"use strict";

/**
 * ACTION AUTHORITY GATE V1 — Wave 4 fourth repair: runtime-local trust domain.
 *
 * Direct tests for every Codex repro:
 *   BLOCKER 1 — public session issuer removed; NO minting surface anywhere on
 *               the public/direct action surface
 *   BLOCKER 2 — direct createGate import absent; forged evaluator injection
 *               over the canonical registry impossible
 *   BLOCKER 3 — session brand runtime-local; cross-runtime replay rejected in
 *               BOTH directions without runtimeId strings
 *
 * Plus a structural export scan of every action module.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createActionAuthorityRuntime, createAuthenticationDomain, DECISION } = require("../../src/action");
const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { authenticate } = require("./helpers");

const CLOCK = { nowMs: () => 1000 };

async function makeDomain() {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const { registry, registrars } = capabilityRuntime;
    const store = createMemoryAuthorityStore();
    const authDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    const rt = createActionAuthorityRuntime({
        capabilityRuntime,
        authorityStore: store,
        authVerifier: authDomain.verifier,
        trustedScopeBindings: { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } },
        clock: CLOCK
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
    return { registry, registrars, store, rt, authDomain, intent };
}

// ---------------------------------------------------------------------------
// BLOCKER 1 — public session issuer
// ---------------------------------------------------------------------------

test("B1-R4: public API has no createAuthSessionIssuer", () => {
    const api = require("../../src/action");
    assert.equal(typeof api.createAuthSessionIssuer, "undefined");
});

test("B1-R4: direct require of every action submodule exposes no issuer mint", () => {
    const modules = [
        "../../src/action/index.js",
        "../../src/action/authSession.js",
        "../../src/action/authDomain.js",
        "../../src/action/gate.js",
        "../../src/action/runtime.js",
        "../../src/action/intent.js",
        "../../src/action/errors.js",
        "../../src/action/clock.js"
    ];
    const FORBIDDEN = ["createAuthSessionIssuer", "mintAuthSession", "issueIdentity", "issueSession", "mintSession", "bindAuthentication", "onReady"];
    for (const m of modules) {
        const mod = require(m);
        for (const name of FORBIDDEN) {
            assert.equal(typeof mod[name], "undefined", `${m} must not export ${name}`);
        }
    }
});

test("B1-R4: no public callable can produce a session trusted by a canonical runtime", async () => {
    const api = require("../../src/action");
    const h = await makeDomain();
    // Every callable export is probed with victim-shaped payloads. Whatever
    // comes back must NOT satisfy runtime A's verifier. The composition root
    // (createActionAuthorityRuntime) is the only function allowed to build a
    // NEW trust domain, and its domains never trust each other's sessions.
    for (const [name, value] of Object.entries(api)) {
        if (typeof value !== "function") continue;
        if (name === "createActionAuthorityRuntime") continue;
        let minted = null;
        try {
            minted = await value({ principal: "victim" }, { principal: "victim" });
        } catch { /* typed rejection is fine */ }
        if (minted && typeof minted === "object" && typeof minted.then !== "function") {
            const d = await h.rt.evaluate(h.intent, minted);
            assert.notEqual(d.decision, DECISION.ALLOW,
                `public export '${name}' must not be able to produce a trusted session`);
        }
    }
});

test("B1-R4: runtime surface exposes no mint/issuer/bind/bootstrap function", async () => {
    const h = await makeDomain();
    for (const forbidden of ["mintSession", "issueIdentity", "issueSession", "bindAuthentication", "onReady", "issuer", "sessionIssuer", "authVerifier", "verifier", "authDomain", "gate", "createGate"]) {
        assert.equal(typeof h.rt[forbidden], "undefined", `rt.${forbidden} must not exist`);
    }
    assert.deepEqual(Object.keys(h.rt).sort(), ["admit", "evaluate"]);
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — direct module import exposes injectable gate
// ---------------------------------------------------------------------------

test("B2-R4: require('src/action/gate').createGate === undefined", () => {
    const gate = require("../../src/action/gate");
    assert.equal(gate.createGate, undefined, "createGate must not exist on gate module");
    assert.equal(typeof gate.createGate, "undefined");
});

test("B2-R4: no action module exports any gate-minting function", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const key of Object.keys(mod)) {
            assert.ok(!/^createGate$|^buildGate$|^makeGate$|^newGate$/i.test(key),
                `${f} must not export gate minting function '${key}'`);
        }
    }
});

test("B2-R4: forged evaluator over canonical registry cannot be injected anywhere", async () => {
    const h = await makeDomain();
    const forgedEvaluation = {
        allowed: true,
        reasonCode: "AUTHORIZED",
        snapshot: {
            generation: 0, capabilityId: "cap.x", subject: "alice", principal: "alice",
            actions: ["read"], scope: ["safe.target"], allowedPurposes: [],
            identityBinding: null, maxExecutions: null
        }
    };

    // The historical exploit path is gone: no importable constructor accepts
    // an authorityEvaluator. createActionAuthorityRuntime requires a
    // pre-bound authVerifier and accepts NO evaluator or verifier injection
    // parameter at all — even if an attacker passes one, it is ignored
    // (extra unknown options are never read for trust). The attacker uses
    // its OWN AuthenticationDomain (that is a separate trust domain, which
    // grants no access to h's domain).
    const attackerDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    const attackerRuntime = createActionAuthorityRuntime({
        capabilityRuntime: { registry: h.registry, registrars: h.registrars },
        authorityStore: h.store,
        authVerifier: attackerDomain.verifier,
        trustedScopeBindings: { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } },
        clock: CLOCK,
        authorityEvaluator: async () => forgedEvaluation,   // injection attempt: IGNORED
        isCanonicalEvaluation: () => true,                   // injection attempt: IGNORED
        verifySession: () => true,                           // injection attempt: IGNORED
        evaluator: async () => forgedEvaluation,             // injection attempt: IGNORED
        gate: { evaluate: async () => ({ decision: "ALLOW" }) } // injection attempt: IGNORED
    });
    const attackerIntent = attackerRuntime.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.x", operation: "read", arguments: { target: "safe.target" } }));

    // The injected evaluator/verifier options are NOT the trust path: the
    // runtime consults only its pre-bound authVerifier. The forged evaluation
    // object passed as a session is rejected as identity (it is not in the
    // attacker domain's brand), and the injected evaluator hooks had zero
    // effect.
    const d = await attackerRuntime.evaluate(attackerIntent, forgedEvaluation);
    assert.equal(d.decision, DECISION.DENY, "injected evaluator/gate options must be ignored");
    assert.equal(d.reasonCode, "INVALID_IDENTITY");

    // And a session minted by runtime h cannot be replayed on the attacker
    // runtime either (different brand), even with the injected hooks.
    const legitSession = h.authDomain.authenticate({ claimedPrincipal: "alice" });
    const d2 = await attackerRuntime.evaluate(attackerIntent, legitSession);
    assert.equal(d2.decision, DECISION.DENY, "cross-runtime replay must fail even with injected options");
    assert.equal(d2.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// BLOCKER 3 — runtime-local session brand; cross-runtime replay
// ---------------------------------------------------------------------------

test("B3-R4: A session -> A accepted", async () => {
    const A = await makeDomain();
    const s = A.authDomain.authenticate({ claimedPrincipal: "alice" });
    assert.equal((await A.rt.evaluate(A.intent, s)).decision, DECISION.ALLOW);
});

test("B3-R4: A session -> B rejected; B session -> A rejected (both directions)", async () => {
    const A = await makeDomain();
    const B = await makeDomain();
    const sa = A.authDomain.authenticate({ claimedPrincipal: "alice" });
    const sb = B.authDomain.authenticate({ claimedPrincipal: "alice" });

    const ab = await B.rt.evaluate(B.intent, sa);
    assert.equal(ab.decision, DECISION.DENY);
    assert.equal(ab.reasonCode, "INVALID_IDENTITY");

    const ba = await A.rt.evaluate(A.intent, sb);
    assert.equal(ba.decision, DECISION.DENY);
    assert.equal(ba.reasonCode, "INVALID_IDENTITY");
});

test("B3-R4: forged/cloned/JSON session rejected by canonical runtime", async () => {
    const A = await makeDomain();
    const s = A.authDomain.authenticate({ claimedPrincipal: "alice" });
    const candidates = [
        ["clone", { ...s }],
        ["frozenClone", Object.freeze({ ...s })],
        ["json", JSON.parse(JSON.stringify(s))],
        ["structural", { principal: "alice", sessionId: "", channel: "" }],
        ["symbolLookalike", { principal: "alice", sessionId: "", channel: "", [Symbol("brand")]: 1 }],
        ["nullProto", Object.assign(Object.create(null), { principal: "alice", sessionId: "", channel: "" })]
    ];
    for (const [label, candidate] of candidates) {
        const d = await A.rt.evaluate(A.intent, candidate);
        assert.equal(d.decision, DECISION.DENY, `${label} must be rejected`);
        assert.equal(d.reasonCode, "INVALID_IDENTITY", `${label} reason`);
    }
});

test("B3-R4: no runtimeId string trusted — string fields on forged session change nothing", async () => {
    const A = await makeDomain();
    const B = await makeDomain();
    const sb = B.authDomain.authenticate({ claimedPrincipal: "alice" });
    // Even if the attacker adds plausible "runtime identity" fields, the
    // decision is object-identity based, never string-based.
    const spoofed = Object.freeze({ ...sb, runtimeId: "A", domain: "A", trusted: true });
    const d = await A.rt.evaluate(A.intent, spoofed);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// STRUCTURAL EXPORT SCAN — no privileged surface anywhere in src/action
// ---------------------------------------------------------------------------

test("structural: no module in src/action exports privileged trust constructors", () => {
    const dir = path.join(__dirname, "../../src/action");
    const FORBIDDEN = [
        "createAuthSessionIssuer",
        "createGate",
        "mintAuthSession",
        "issueIdentity",
        "mintRuntimeIdentity",
        "createRuntimeIdentityContext",
        "createIntentAdmission",
        "createReadOnlyAuthorityContext",
        "mintSession",
        "createSessionTrustDomain",
        "createEvaluationBrand",
        "injectEvaluator",
        "setEvaluator",
        "setVerifier",
        "setClock",
        "sessionBrand",
        "authSessionBrands",
        "EVAL_BRAND",
        "brandGate",
        "bindAuthentication",
        "onReady",
        "authBinder"
    ];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const name of FORBIDDEN) {
            assert.equal(typeof mod[name], "undefined", `${f} must not export ${name}`);
        }
    }
});

test("structural: source scan — no export binding for issuer/gate minting or brand state", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    const FORBIDDEN_NAMES = [
        "createAuthSessionIssuer", "createGate", "mintAuthSession", "mintSession",
        "issueIdentity", "issueSession", "sessionBrand", "authSessionBrands",
        "EVAL_BRAND", "brandGate", "buildGate", "bindAuthentication", "onReady"
    ];
    for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        // Match module.exports = { ... } object literals and exports.X = assignments.
        const exportBlocks = [...text.matchAll(/module\.exports\s*=\s*\{([\s\S]*?)\};/g)].map((m) => m[1]);
        exportBlocks.push(...[...text.matchAll(/exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g)].map((m) => m[1]));
        if (exportBlocks.length === 0) continue;
        for (const block of exportBlocks) {
            for (const name of FORBIDDEN_NAMES) {
                assert.ok(!new RegExp(`(^|[^A-Za-z0-9_$])${name}([^A-Za-z0-9_$]|$)`).test(block),
                    `${f}: module export block must not bind '${name}'`);
            }
        }
    }
});
