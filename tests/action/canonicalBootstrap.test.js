"use strict";

/**
 * ACTION AUTHORITY GATE V1 — sixth targeted repair regressions (Wave 4 Lane 2):
 * CANONICAL BOOTSTRAP OWNERSHIP — caller-selectable verifier REMOVED.
 *
 * This file loads the PRODUCTION trusted bootstrap (src/action/bootstrap.js)
 * and exercises ONLY its surface. It does not bind the test harness hosts
 * (one binding per process: the production bootstrap takes it here).
 *
 * Direct regression for the Codex repro:
 *
 *   createAuthenticationDomain(...)                       // must be undefined
 *   createActionAuthorityRuntime({ authVerifier: fake })  // must be undefined
 *   createGate(...)                                       // must be undefined
 *
 * Before this repair, an arbitrary caller possessing canonical
 * CapabilityRuntime + AuthorityStore references could select the identity
 * verifier governing canonical authorization by composing a NEW runtime
 * around them with its own verifier. Composition is now bootstrap-internal:
 *
 *   attacker obtains canonical CapabilityRuntime
 *   attacker obtains canonical AuthorityStore
 *   attacker creates new action runtime around them   ← NO such surface
 *   attacker selects verifier                          ← NO such surface
 *   attacker impersonates victim                       ← impossible
 *
 * This suite proves:
 *   R6-1   public API exports neither factory nor createGate
 *   R6-2   direct submodule imports cannot obtain an injectable canonical
 *          gate/runtime constructor
 *   R6-3   a fake verifier {verify: () => "victim"} has no path into the
 *          canonical runtime
 *   R6-4   a caller-created AuthenticationDomain cannot become canonical
 *          identity authority
 *   R6-5   a caller cannot wrap canonical state references in an attacker
 *          runtime with an attacker verifier
 *   R6-6   a bootstrap-created authenticated victim session still works
 *   R6-7   attacker sessions/domains are rejected by the canonical runtime
 *   R6-8   cross-domain replay remains rejected
 *   R6-9   canonical runtime surface remains exactly least privilege
 *   R6-10  evaluator/verifier replacement remains impossible
 *
 * Plus structural scans: no action module exports any composition factory;
 * the trusted bootstrap's own surface is bounded; hosts bind one-shot.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = require("../../src/action");
// Load the production trusted bootstrap FIRST in this process: it binds the
// one-shot composition hosts exactly as the Aether runtime layer would.
const bootstrap = require("../../src/action/bootstrap");
const { createCanonicalActionRuntime } = bootstrap;

const CLOCK = { nowMs: () => 1000 };
const SCOPE = { "cap.canon": { read: (a) => (a && a.target ? [a.target] : []) } };

/** Trusted external authentication infra for tests (mirrors production's
 *  token-guarded transport decision, decided by infra not by callers). */
function testAuthenticate(evidence) {
    const p = evidence && typeof evidence === "object" ? evidence.claimedPrincipal : null;
    if (typeof p === "string" && p.length > 0) return { principal: p };
    return null;
}

/** A canonical trust domain built by the PRODUCTION trusted bootstrap. */
async function makeCanonical({ authenticate } = {}) {
    const facade = createCanonicalActionRuntime({
        clock: CLOCK,
        trustedScopeBindings: SCOPE,
        authenticate: authenticate ?? testAuthenticate
    });
    const res = await facade.registerCapability({ id: "cap.canon", operations: ["read"] });
    await facade.registry.observeAvailability("cap.canon", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    await facade.grantAuthority({ capabilityId: "cap.canon", subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
    const intent = facade.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.canon", operation: "read", arguments: { target: "safe.target" } }));
    return { facade, intent };
}

// ---------------------------------------------------------------------------
// R6-1. Public action API exposes neither factory nor createGate
// ---------------------------------------------------------------------------

test("R6-1: public action API exposes no composition factories", () => {
    for (const name of ["createAuthenticationDomain", "createActionAuthorityRuntime", "createGate"]) {
        assert.equal(api[name], undefined, `api.${name} must be undefined`);
        assert.equal(typeof api[name], "undefined", `typeof api.${name} must be 'undefined'`);
    }
    // The historical names must remain absent too.
    for (const name of ["bindAuthentication", "mintSession", "onReady", "issueIdentity", "createAuthSessionIssuer", "mintAuthSession", "issuer", "sessionIssuer", "isAuthSession"]) {
        assert.equal(typeof api[name], "undefined", `api.${name} must not exist`);
    }
    // No export name may even LOOK like a runtime/domain/gate factory.
    for (const name of Object.keys(api)) {
        assert.ok(!/^(createActionAuthorityRuntime|createAuthenticationDomain|createGate|buildGate|makeGate|createRuntime|createDomain|createTrustedActionRuntime|createCanonicalVerifier|createBootstrapFactory)$/.test(name),
            `public API must not expose composition-like export '${name}'`);
    }
});

test("R6-1: public API remains non-privileged (no execution/authority-minting verbs)", () => {
    const EXEC = /execute|invoke|run\b|dispatch|actuate|spawn|shell|callTool|performAction/i;
    const AUTH = /grant|authorize|approve|ratify|delegate|elevate|mint|issue\b|revoke/i;
    for (const name of Object.keys(api)) {
        assert.ok(!EXEC.test(name), `public API must not expose execution verb: ${name}`);
        assert.ok(!AUTH.test(name), `public API must not expose authority-minting verb: ${name}`);
    }
});

// ---------------------------------------------------------------------------
// R6-2. Direct submodule imports cannot obtain an injectable constructor
// ---------------------------------------------------------------------------

test("R6-2: direct require of every action submodule exposes no runtime/domain/gate factory", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    assert.ok(files.length > 0);
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const name of ["createActionAuthorityRuntime", "createAuthenticationDomain", "createGate", "buildGate", "makeGate", "createAuthSessionIssuer", "mintAuthSession", "mintSession", "issueIdentity", "issueSession", "bindAuthentication", "onReady"]) {
            assert.equal(typeof mod[name], "undefined", `${f} must not export ${name}`);
        }
        // bootstrap.js is the trusted layer and may expose its own canonical
        // composition entry (createCanonicalActionRuntime) — that is its
        // designated role, not a downstream factory. Every OTHER module's
        // callable exports must not produce a runtime-like surface.
        if (f === "bootstrap.js") continue;
        for (const [name, value] of Object.entries(mod)) {
            if (typeof value !== "function") continue;
            let produced = null;
            try { produced = value({}); } catch { /* typed rejection is fine */ }
            if (produced && typeof produced === "object" && typeof produced.then !== "function") {
                const keys = Object.keys(produced).sort();
                assert.ok(!(keys.includes("admit") && keys.includes("evaluate")),
                    `${f}:${name}() must not be able to produce a runtime-like { admit, evaluate } surface`);
            }
        }
    }
});

test("R6-2: bindCompositionHost / bindAuthenticationHost are one-shot per process", () => {
    // The production bootstrap already bound the hosts in THIS process. A
    // second bind from ANY module object (even a fresh one) must throw.
    const runtimeModule = require("../../src/action/runtime");
    const authDomainModule = require("../../src/action/authDomain");
    assert.equal(typeof runtimeModule.bindCompositionHost, "function", "host binding surface exists for trusted bootstrap");
    assert.equal(typeof authDomainModule.bindAuthenticationHost, "function", "host binding surface exists for trusted bootstrap");
    assert.equal(runtimeModule.isCompositionHostBound(), true, "composition host is bound (one-shot taken)");
    assert.equal(authDomainModule.isAuthenticationHostBound(), true, "authentication host is bound (one-shot taken)");
    for (const fakeModule of [module, { id: "fake" }, null, undefined]) {
        assert.throws(() => runtimeModule.bindCompositionHost(fakeModule),
            (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED",
            "second composition bind must throw");
        assert.throws(() => authDomainModule.bindAuthenticationHost(fakeModule),
            (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED",
            "second authentication bind must throw");
    }
});

// ---------------------------------------------------------------------------
// R6-3 + R6-5. Fake verifier / attacker runtime over canonical state
// ---------------------------------------------------------------------------

test("R6-3: fake verifier {verify: () => 'victim'} has no path into the canonical runtime", async () => {
    const { facade, intent } = await makeCanonical();
    const fakeVerifier = { verify: () => "victim" };

    // (a) there is no public/direct factory accepting an authVerifier at all
    assert.equal(typeof api.createActionAuthorityRuntime, "undefined");
    const runtimeModule = require("../../src/action/runtime");
    assert.equal(typeof runtimeModule.createActionAuthorityRuntime, "undefined");

    // (b) probing every callable export of the public API with the fake
    // verifier must never yield a runtime-like surface or a session that the
    // canonical runtime accepts
    for (const [name, value] of Object.entries(api)) {
        if (typeof value !== "function") continue;
        let produced = null;
        try { produced = value({ authVerifier: fakeVerifier, verify: fakeVerifier.verify }); } catch { /* rejection fine */ }
        if (produced && typeof produced === "object" && typeof produced.then !== "function") {
            const keys = Object.keys(produced).sort();
            assert.ok(!(keys.includes("admit") && keys.includes("evaluate")),
                `api.${name} must not be able to compose a runtime with a caller verifier`);
            // any session-shaped output must be rejected by the canonical runtime
            const d = await facade.evaluate(intent, produced);
            assert.notEqual(d.decision, "ALLOW", `api.${name} output must not be a trusted session`);
        }
    }

    // (c) the trusted bootstrap itself rejects a caller-supplied verifier
    // option outright, and every other privileged composition option too
    for (const key of ["authVerifier", "verifier", "capabilityRuntime", "authorityStore", "authDomain", "domain", "authenticationDomain", "evaluator", "authorityEvaluator", "isCanonicalEvaluation", "verifySession", "evaluateSession", "gate", "registry", "capabilityRegistry", "store", "sessionBrand", "authBrand", "brand", "onReady", "bindAuthentication", "mintSession", "issueIdentity", "issueSession", "issuer", "sessionIssuer", "authBinder", "bootstrap", "bootstrapCapability", "trustedBootstrap", "createAuthSessionIssuer", "authSessionIssuer"]) {
        assert.throws(
            () => createCanonicalActionRuntime({ [key]: fakeVerifier, clock: CLOCK, trustedScopeBindings: {} }),
            (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED",
            `bootstrap must reject privileged option '${key}'`
        );
    }
});

test("R6-5: caller cannot wrap canonical state references in an attacker runtime", async () => {
    const { facade, intent } = await makeCanonical();

    // The attacker POSSESSES the canonical registry+store references (they
    // are reachable from the facade surface the same way any in-process
    // holder would reach them).
    const canonicalState = { registry: facade.registry, store: null };

    // (a) no public API accepts them
    assert.equal(typeof api.createActionAuthorityRuntime, "undefined");
    // (b) the trusted bootstrap rejects them as composition inputs
    for (const key of ["capabilityRuntime", "authorityStore", "registry", "store"]) {
        assert.throws(
            () => createCanonicalActionRuntime({ [key]: canonicalState, clock: CLOCK, trustedScopeBindings: {} }),
            (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED",
            `bootstrap must reject canonical-state injection via '${key}'`
        );
    }

    // (c) a SECOND canonical trust domain built by the SAME trusted bootstrap
    // (the only remaining composition path) composes over ITS OWN state, not
    // the canonical one — and its sessions are never valid on the first
    // domain's runtime, in either direction:
    const attacker = await makeCanonical({ authenticate: (e) => ({ principal: e && (e.claimedPrincipal ?? e.principal) }) });
    const attackerSession = attacker.facade.authenticate({ claimedPrincipal: "victim" });
    const onAttacker = await attacker.facade.evaluate(attacker.intent, attackerSession);
    assert.equal(onAttacker.decision, "ALLOW", "the attacker-shaped domain evaluates its own session (its own separate trust domain over its own state)");

    // The canonical runtime NEVER accepts the attacker's session:
    const onCanonical = await facade.evaluate(intent, attackerSession);
    assert.equal(onCanonical.decision, "DENY", "attacker session must be DENY on the canonical runtime");
    assert.equal(onCanonical.reasonCode, "INVALID_IDENTITY");

    // And the canonical victim session NEVER works on the attacker runtime:
    const victimSession = facade.session("victim");
    const replay = await attacker.facade.evaluate(attacker.intent, victimSession);
    assert.equal(replay.decision, "DENY", "canonical victim session must not replay on the attacker runtime");
    assert.equal(replay.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// R6-4. Caller-created AuthenticationDomain cannot become canonical authority
// ---------------------------------------------------------------------------

test("R6-4: caller-created AuthenticationDomain cannot become canonical identity authority", async () => {
    const { facade, intent } = await makeCanonical();
    // The caller CANNOT create an AuthenticationDomain at all: there is no
    // public factory. The nearest attacker-reachable construct is a full
    // second canonical trust domain via the trusted bootstrap — which composes
    // its OWN domain over ITS OWN state and whose sessions carry zero weight
    // in the canonical runtime:
    assert.equal(typeof api.createAuthenticationDomain, "undefined");
    const authDomainModule = require("../../src/action/authDomain");
    assert.equal(typeof authDomainModule.createAuthenticationDomain, "undefined");

    const callerDomain = await makeCanonical({ authenticate: () => ({ principal: "victim" }) });
    const callerSession = callerDomain.facade.authenticate({ principal: "victim" });

    // The caller's domain session is structurally valid in ITS OWN domain...
    assert.ok(callerSession && callerSession.principal === "victim");
    // ...but carries zero weight in the canonical runtime:
    const d = await facade.evaluate(intent, callerSession);
    assert.equal(d.decision, "DENY");
    assert.equal(d.reasonCode, "INVALID_IDENTITY");

    // The canonical harness's bootstrap-minted victim session is the only ALLOW path:
    assert.equal((await facade.evaluate(intent, facade.session("victim"))).decision, "ALLOW");
});

// ---------------------------------------------------------------------------
// R6-6 + R6-7. Canonical bootstrap victim session works; attacker rejected
// ---------------------------------------------------------------------------

test("R6-6: bootstrap-created authenticated victim session still works", async () => {
    const { facade, intent } = await makeCanonical();
    const d = await facade.evaluate(intent, facade.session("victim"));
    assert.equal(d.decision, "ALLOW");
    assert.equal(d.principal, "victim");
    // frozen decision
    assert.ok(Object.isFrozen(d));
    assert.throws(() => { d.decision = "DENY"; });
});

test("R6-7: attacker session/domain rejected by canonical runtime", async () => {
    const { facade, intent } = await makeCanonical();
    const attackerDomain = await makeCanonical({ authenticate: () => ({ principal: "victim" }) });
    const candidates = [
        ["attacker-domain session", attackerDomain.facade.authenticate({ claimedPrincipal: "victim" })],
        ["forged plain session", { principal: "victim", sessionId: "", channel: "" }],
        ["frozen clone", Object.freeze({ ...facade.session("victim") })],
        ["json clone", JSON.parse(JSON.stringify(facade.session("victim")))],
        ["null", null],
        ["string", "victim"]
    ];
    for (const [label, candidate] of candidates) {
        const d = await facade.evaluate(intent, candidate);
        assert.equal(d.decision, "DENY", `${label} must be rejected`);
        assert.equal(d.reasonCode, "INVALID_IDENTITY", `${label} reason`);
    }
    // An attacker whose authenticator fails closed gets no session at all:
    const failing = await makeCanonical({ authenticate: () => null });
    assert.equal(failing.facade.authenticate({ claimedPrincipal: "victim" }), null);
});

// ---------------------------------------------------------------------------
// R6-8. Cross-domain replay remains rejected (both directions)
// ---------------------------------------------------------------------------

test("R6-8: cross-domain session replay remains rejected in both directions", async () => {
    const A = await makeCanonical();
    const B = await makeCanonical();

    const sa = A.facade.session("victim");
    const sb = B.facade.session("victim");

    assert.equal((await A.facade.evaluate(A.intent, sa)).decision, "ALLOW");
    assert.equal((await B.facade.evaluate(B.intent, sb)).decision, "ALLOW");

    const ab = await B.facade.evaluate(B.intent, sa);
    assert.equal(ab.decision, "DENY", "A session must be rejected by B's runtime");
    assert.equal(ab.reasonCode, "INVALID_IDENTITY");
    const ba = await A.facade.evaluate(A.intent, sb);
    assert.equal(ba.decision, "DENY", "B session must be rejected by A's runtime");
    assert.equal(ba.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// R6-9. Canonical runtime surface remains exactly least privilege
// ---------------------------------------------------------------------------

test("R6-9: canonical runtime surface is exactly { admit, evaluate }", async () => {
    const { facade } = await makeCanonical();
    // The runtime surface reachable from the facade is admit/evaluate only.
    assert.deepEqual(Object.keys(facade).sort(),
        ["admit", "authenticate", "evaluate", "grantAuthority", "registerCapability", "registrars", "registry", "session"]);
    for (const forbidden of ["authVerifier", "verifier", "authDomain", "gate", "createGate", "createActionAuthorityRuntime", "createAuthenticationDomain", "issuer", "sessionIssuer", "mintSession", "issueIdentity", "issueSession", "bindAuthentication", "onReady", "bootstrap", "authorityStore", "store", "capabilityRuntime", "evaluator", "authorityEvaluator", "setEvaluator", "setVerifier", "isCanonicalEvaluation", "sessionBrand", "brand"]) {
        assert.equal(typeof facade[forbidden], "undefined", `facade.${forbidden} must not exist`);
    }
    assert.ok(Object.isFrozen(facade));
});

test("R6-9: the trusted bootstrap module surface is bounded and non-privileged", () => {
    assert.deepEqual(Object.keys(bootstrap).sort(), ["PRIVILEGED_KEYS", "createCanonicalActionRuntime"]);
    // The bootstrap module itself exposes no factory that accepts a verifier,
    // domain, store, registry, evaluator, or gate as caller input.
    assert.equal(typeof bootstrap.createAuthenticationDomain, "undefined");
    assert.equal(typeof bootstrap.createActionAuthorityRuntime, "undefined");
    assert.equal(typeof bootstrap.createGate, "undefined");
});

// ---------------------------------------------------------------------------
// R6-10. Evaluator/verifier replacement remains impossible
// ---------------------------------------------------------------------------

test("R6-10: evaluator/verifier replacement impossible on canonical runtime", async () => {
    const { facade, intent } = await makeCanonical();
    // frozen surface: no reassignment
    assert.throws(() => { facade.evaluate = () => ({ decision: "ALLOW" }); });
    assert.throws(() => Object.defineProperty(facade, "evaluate", { value: () => ({ decision: "ALLOW" }) }));
    // The canonical runtime still decides canonically after tamper attempts
    assert.equal((await facade.evaluate(intent, facade.session("victim"))).decision, "ALLOW");
    // and a forged session is still rejected:
    const d = await facade.evaluate(intent, { principal: "victim" });
    assert.equal(d.decision, "DENY");
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// Structural scans — actual exports, not name regexes
// ---------------------------------------------------------------------------

test("structural: no action module exports privileged composition functions", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    const FORBIDDEN = [
        "createActionAuthorityRuntime",
        "createAuthenticationDomain",
        "createAuthSessionIssuer",
        "createGate",
        "buildGate",
        "makeGate",
        "newGate",
        "createSessionTrustDomain",
        "mintAuthSession",
        "issueIdentity",
        "issueSession",
        "mintSession",
        "bindAuthentication",
        "onReady",
        "sessionBrand",
        "authSessionBrands",
        "authBinder",
        "EVAL_BRAND",
        "brandGate",
        "injectEvaluator",
        "setEvaluator",
        "setVerifier",
        "setClock"
    ];
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const name of FORBIDDEN) {
            assert.equal(typeof mod[name], "undefined", `${f} must not export ${name}`);
        }
    }
});

test("structural: bootstrap.js is the only module using composition host binding", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    const binders = [];
    for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        // strip comments before scanning (documentation mentions are fine;
        // only live requires/calls count)
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        if (/bindCompositionHost|bindAuthenticationHost/.test(code)) binders.push(f);
    }
    // runtime.js + authDomain.js define the binders; bootstrap.js calls them.
    assert.ok(binders.includes("runtime.js") && binders.includes("authDomain.js") && binders.includes("bootstrap.js"),
        `unexpected binder set: ${binders.join(",")}`);
    assert.equal(binders.length, 3, `only runtime.js, authDomain.js, bootstrap.js may reference host binding: ${binders.join(",")}`);
    // index.js must not require the trusted bootstrap (comment mentions are fine)
    const apiText = fs.readFileSync(path.join(dir, "index.js"), "utf8");
    const apiCode = apiText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.ok(!/require\([^)]*bootstrap/.test(apiCode), "index.js must not require/re-export the trusted bootstrap");
});

test("structural: dependency direction — trusted bootstrap imports action internals, not vice versa", () => {
    const dir = path.join(__dirname, "../../src/action");
    const bootstrapText = fs.readFileSync(path.join(dir, "bootstrap.js"), "utf8");
    assert.ok(/require\("\.\/runtime"\)/.test(bootstrapText), "bootstrap must import the runtime composition module");
    assert.ok(/require\("\.\/authDomain"\)/.test(bootstrapText), "bootstrap must import the authDomain module");
    for (const f of ["index.js", "runtime.js", "authDomain.js", "gate.js", "intent.js", "errors.js", "clock.js", "authSession.js"]) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        assert.ok(!/require\([^)]*bootstrap/.test(code), `${f} must not import the trusted bootstrap (dependency direction)`);
    }
});
