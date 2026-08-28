"use strict";

/**
 * ACTION AUTHORITY GATE V1 — fifth targeted repair regressions (Wave 4):
 * caller-owned auth bootstrap REMOVED.
 *
 * Direct regression for every Codex repro:
 *   1.  runtime constructor rejects/ignores onReady; no privileged callback
 *       obtainable
 *   2.  no bindAuthentication surface exists
 *   3.  no mintSession surface exists downstream
 *   4.  authenticate => null cannot mint claimed victim
 *   5.  authenticate => undefined cannot mint
 *   6.  authenticate => malformed object cannot mint
 *   7.  authenticate throws => fail closed
 *   8.  no caller principal fallback anywhere
 *   9.  retained/replayed bootstrap callback impossible
 *   10. canonical authenticated session still works
 *   11. cross-runtime session replay remains rejected
 *   12. forged/clone/JSON/Proxy sessions remain rejected
 *
 * Plus structural export scans: no action module exports any auth bootstrap,
 * mint, issuer, identity-mint, or session-brand surface.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createActionAuthorityRuntime,
    createAuthenticationDomain,
    parseActionIntent,
    DECISION
} = require("../../src/action");
const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { makeHarness, authenticate } = require("./helpers");

const CLOCK = { nowMs: () => 1000 };

async function setupAvailable(h, id = "filesystem.read", ops = ["read"]) {
    const res = await h.registerCapability({ id, operations: ops });
    await h.registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

/** Minimal standalone runtime + trusted AuthenticationDomain. */
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
// 1. Runtime constructor rejects onReady; no privileged callback obtainable
// ---------------------------------------------------------------------------

test("R5-1: onReady option is REJECTED at composition (no privileged callback)", () => {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const store = createMemoryAuthorityStore();
    const authDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    let captured = null;
    assert.throws(
        () => createActionAuthorityRuntime({
            capabilityRuntime, authorityStore: store,
            authVerifier: authDomain.verifier,
            trustedScopeBindings: {}, clock: CLOCK,
            onReady: (caps) => { captured = caps; }
        }),
        (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED",
        "constructor must reject onReady"
    );
    assert.equal(captured, null, "the onReady callback must never be invoked");
});

test("R5-1: the Codex exploit shape cannot capture bindAuthentication", () => {
    // EXACT Codex repro shape: createActionAuthorityRuntime({ ..., onReady({
    // bindAuthentication }) { mint = bindAuthentication({...}).mintSession } })
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const store = createMemoryAuthorityStore();
    const authDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    let mint;
    assert.throws(
        () => createActionAuthorityRuntime({
            capabilityRuntime, authorityStore: store,
            authVerifier: authDomain.verifier,
            trustedScopeBindings: {}, clock: CLOCK,
            onReady({ bindAuthentication }) {
                mint = bindAuthentication({ authenticate: () => ({ principal: "victim" }) }).mintSession;
            }
        }),
        (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED"
    );
    assert.equal(typeof mint, "undefined", "no mint capability can be captured from onReady");
});

// ---------------------------------------------------------------------------
// 2 + 3. No bindAuthentication / mintSession surface anywhere downstream
// ---------------------------------------------------------------------------

test("R5-2/3: no bindAuthentication or mintSession surface on runtime, domain, or module exports", () => {
    const api = require("../../src/action");
    for (const name of ["bindAuthentication", "mintSession", "onReady", "issueIdentity", "createAuthSessionIssuer", "mintAuthSession", "issuer", "sessionIssuer"]) {
        assert.equal(typeof api[name], "undefined", `api.${name} must not exist`);
    }
    const runtimeModule = require("../../src/action/runtime");
    const domainModule = require("../../src/action/authDomain");
    for (const name of ["bindAuthentication", "mintSession", "onReady", "issueIdentity"]) {
        assert.equal(typeof runtimeModule[name], "undefined", `runtime.js.${name} must not be exported`);
        assert.equal(typeof domainModule[name], "undefined", `authDomain.js.${name} must not be exported`);
    }
});

test("R5-2/3: runtime surface exposes NO authentication capability of any kind", async () => {
    const h = await makeDomain();
    // The returned surface is EXACTLY { admit, evaluate }: every own key is
    // checked, not just known names.
    assert.deepEqual(Object.keys(h.rt).sort(), ["admit", "evaluate"]);
    // The AuthenticationDomain surface is EXACTLY { authenticate, verifier }:
    // it never exposes bindAuthentication or mintSession.
    assert.deepEqual(Object.keys(h.authDomain).sort(), ["authenticate", "verifier"].sort());
    // The verifier capability exposes exactly verify; it can neither mint nor bind.
    assert.deepEqual(Object.keys(h.authDomain.verifier), ["verify"]);
    // Deep-own-key scan: no mint/bind-like key anywhere on either surface.
    const MINT_LIKE = /mint|issue|bind|onReady|bootstrap|brand/i;
    for (const obj of [h.rt, h.authDomain, h.authDomain.verifier]) {
        for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(obj) ?? {}).concat(Object.keys(obj))) {
            assert.ok(!MINT_LIKE.test(key) || key === "authenticate" || key === "verify",
                `unexpected privileged key '${key}' on surface`);
        }
    }
});

// ---------------------------------------------------------------------------
// 4 + 5 + 6 + 7. authenticate() failure modes all fail closed
// ---------------------------------------------------------------------------

test("R5-4: authenticate => null cannot mint claimed victim", async () => {
    const h = await makeHarness({ authenticate: () => null });
    await setupAvailable(h);
    await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    // The caller claims "victim"; authentication returns null => NO session.
    const minted = h.authDomain.authenticate({ claimedPrincipal: "victim", principal: "victim" });
    assert.equal(minted, null, "null authentication must never mint");
    // And a hostile forged object can never be trusted either.
    const d = await h.evaluate(intent, { principal: "victim", claimedPrincipal: "victim", sessionId: "", channel: "" });
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

test("R5-5: authenticate => undefined cannot mint", async () => {
    const h = await makeHarness({ authenticate: () => undefined });
    await setupAvailable(h);
    await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const minted = h.authDomain.authenticate({ claimedPrincipal: "victim" });
    assert.equal(minted, null, "undefined authentication must never mint");
    const d = await h.evaluate(intent, { principal: "victim", sessionId: "", channel: "" });
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

test("R5-6: authenticate => malformed object cannot mint", async () => {
    for (const malformed of [false, 0, "", {}, { principal: null }, { principal: 42 }, { principal: "" }, { nope: "victim" }, [], ["victim"]]) {
        const h = await makeHarness({ authenticate: () => malformed });
        await setupAvailable(h);
        await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
        const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
        const minted = h.authDomain.authenticate({ claimedPrincipal: "victim" });
        assert.equal(minted, null, `malformed auth result ${JSON.stringify(malformed)} must never mint`);
        const d = await h.evaluate(intent, { principal: "victim", sessionId: "", channel: "" });
        assert.equal(d.decision, DECISION.DENY);
        assert.equal(d.reasonCode, "INVALID_IDENTITY");
    }
});

test("R5-7: authenticate throws => fail closed", async () => {
    const h = await makeHarness({ authenticate: () => { throw new Error("auth infra exploded"); } });
    await setupAvailable(h);
    await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const minted = h.authDomain.authenticate({ claimedPrincipal: "victim" });
    assert.equal(minted, null, "throwing authentication must never mint");
    const d = await h.evaluate(intent, { principal: "victim", sessionId: "", channel: "" });
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// 8. No caller principal fallback anywhere
// ---------------------------------------------------------------------------

test("R5-8: no caller principal fallback — claimed/requested principals are never Authority identity", async () => {
    // The runtime-level fail-closed path: any object that is not proven by the
    // verifier is rejected EVEN IF it carries the exact victim principal the
    // Authority store would accept.
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "victim", actions: ["read"], identityBinding: { principals: ["victim"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const claimedShapes = [
        { principal: "victim" },
        { principal: "victim", requestedPrincipal: "victim" },
        { principal: "victim", claimedPrincipal: "victim" },
        { requestedPrincipal: "victim", claimedPrincipal: "victim" },
        { principal: "victim", claimedPrincipal: "victim", sessionId: "", channel: "" },
        Object.freeze({ principal: "victim" }),
        Object.assign(Object.create(null), { principal: "victim" }),
        JSON.parse(JSON.stringify({ principal: "victim", sessionId: "", channel: "" }))
    ];
    for (const candidate of claimedShapes) {
        const d = await h.evaluate(intent, candidate);
        assert.equal(d.decision, DECISION.DENY, `claimed-principal fallback must not exist: ${JSON.stringify(candidate)}`);
        assert.equal(d.reasonCode, "INVALID_IDENTITY");
    }
    // Source-level proof: the gate never reads a caller principal field.
    const gateText = fs.readFileSync(path.join(__dirname, "../../src/action/runtime.js"), "utf8");
    for (const forbidden of ["fields.principal", "requestedPrincipal ||", "claimedPrincipal ||", "?.principal || fields"]) {
        assert.ok(!gateText.includes(forbidden), `runtime.js must not contain fallback pattern '${forbidden}'`);
    }
    // A minted session's principal is the AUTHENTICATOR's decision, not the
    // caller's claim: a hostile authenticator cannot mint a principal it did
    // not return (the caller claim is telemetry-only).
    const h2 = await makeHarness({ authenticate: () => ({ principal: "auth-decided-principal" }) });
    await setupAvailable(h2);
    const s = h2.mintAuthSession({ claimedPrincipal: "attacker-claimed" });
    assert.equal(s.principal, "auth-decided-principal", "session principal comes from authentication, not the caller claim");
    assert.equal(s.claimedPrincipal, "attacker-claimed", "caller claim retained as telemetry only");
});

// ---------------------------------------------------------------------------
// 9. Retained/replayed bootstrap callback impossible
// ---------------------------------------------------------------------------

test("R5-9: no bootstrap callback exists to retain or replay", async () => {
    const h = await makeDomain();
    // There is no binder capability obtainable at construction time (the
    // constructor returns only the frozen { admit, evaluate } surface).
    const rt2 = createActionAuthorityRuntime({
        capabilityRuntime: { registry: h.registry, registrars: h.registrars },
        authorityStore: h.store,
        authVerifier: h.authDomain.verifier,
        trustedScopeBindings: {}, clock: CLOCK
    });
    // Whatever the caller keeps references to, none can mint:
    const retained = [rt2, h.authDomain, h.authDomain.verifier, h.authDomain.authenticate];
    for (const r of retained) {
        for (const method of ["bindAuthentication", "mintSession", "mint", "issueSession", "issueIdentity"]) {
            if (r && typeof r === "object") {
                assert.equal(typeof r[method], "undefined", `retained object must not expose ${method}`);
            }
        }
    }
    // A retained verifier cannot mint a session for a fresh claim — verify()
    // only reads brand membership.
    const notMinted = h.authDomain.verifier.verify({ principal: "alice", claimedPrincipal: "alice" });
    assert.equal(notMinted, null, "retained verifier must not mint from unbranded input");
    // A SECOND domain's sessions can never verify on this runtime (no shared brand).
    const secondDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    const foreignSession = secondDomain.authenticate({ claimedPrincipal: "alice" });
    const d = await h.rt.evaluate(h.intent, foreignSession);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// 10. Canonical authenticated session still works
// ---------------------------------------------------------------------------

test("R5-10: canonical authenticated session still evaluates to ALLOW", async () => {
    const h = await makeHarness();
    await setupAvailable(h);
    await h.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const d = await h.evaluate(intent, h.session("alice"));
    assert.equal(d.decision, DECISION.ALLOW);
    assert.equal(d.principal, "alice");
    // And through the direct domain path:
    const h2 = await makeDomain();
    const s = h2.authDomain.authenticate({ claimedPrincipal: "alice" });
    assert.equal((await h2.rt.evaluate(h2.intent, s)).decision, DECISION.ALLOW);
});

// ---------------------------------------------------------------------------
// 11. Cross-runtime session replay remains rejected
// ---------------------------------------------------------------------------

test("R5-11: cross-runtime session replay remains rejected (both directions, shared state too)", async () => {
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
    // Shared canonical state does not federate brand trust:
    const A2 = await makeDomain();
    const attackerDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    const attackerRt = createActionAuthorityRuntime({
        capabilityRuntime: { registry: A2.registry, registrars: A2.registrars },
        authorityStore: A2.store,
        authVerifier: attackerDomain.verifier,
        trustedScopeBindings: { "cap.x": { read: (a) => (a && a.target ? [a.target] : []) } },
        clock: CLOCK
    });
    const victimSession = A2.authDomain.authenticate({ claimedPrincipal: "victim" });
    const attackerIntent = attackerRt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "cap.x", operation: "read", arguments: { target: "safe.target" } }));
    const d = await attackerRt.evaluate(attackerIntent, victimSession);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
});

// ---------------------------------------------------------------------------
// 12. Forged/clone/JSON/Proxy sessions remain rejected
// ---------------------------------------------------------------------------

test("R5-12: forged/clone/JSON/Proxy sessions remain rejected with zero Proxy traps", async () => {
    const h = await makeDomain();
    const s = h.authDomain.authenticate({ claimedPrincipal: "alice" });
    const candidates = [
        ["clone", { ...s }],
        ["frozenClone", Object.freeze({ ...s })],
        ["json", JSON.parse(JSON.stringify(s))],
        ["structural", { principal: "alice", sessionId: s.sessionId, channel: s.channel, claimedPrincipal: s.claimedPrincipal }],
        ["symbolLookalike", { ...s, [Symbol("brand")]: 1 }],
        ["nullProto", Object.assign(Object.create(null), { principal: "alice" })],
        ["string", "alice"],
        ["number", 42]
    ];
    for (const [label, candidate] of candidates) {
        const d = await h.rt.evaluate(h.intent, candidate);
        assert.equal(d.decision, DECISION.DENY, `${label} must be rejected`);
        assert.equal(d.reasonCode, "INVALID_IDENTITY", `${label} reason`);
    }
    // Brand-first Proxy rejection: zero traps.
    let traps = 0;
    const hostile = new Proxy({}, {
        get(o, p) { traps++; return o[p]; },
        getPrototypeOf() { traps++; return Object.prototype; },
        ownKeys() { traps++; return []; },
        getOwnPropertyDescriptor() { traps++; return undefined; },
        has() { traps++; return false; },
        set() { traps++; return false; }
    });
    const d = await h.rt.evaluate(h.intent, hostile);
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reasonCode, "INVALID_IDENTITY");
    assert.equal(traps, 0, "no Proxy trap may execute during brand-first rejection");
});

// ---------------------------------------------------------------------------
// AuthenticationDomain composition-time laws
// ---------------------------------------------------------------------------

test("R5: createAuthenticationDomain without trusted authenticate rejects", () => {
    assert.throws(() => createAuthenticationDomain({}), (e) => e.reasonCode === "AUTH_VERIFIER_REQUIRED");
    assert.throws(() => createAuthenticationDomain({ authenticate: "not-a-function" }), (e) => e.reasonCode === "AUTH_VERIFIER_REQUIRED");
});

test("R5: AuthenticationDomain surface is exactly { authenticate, verifier } — no mint, no brand", async () => {
    const h = await makeDomain();
    assert.deepEqual(Object.keys(h.authDomain).sort(), ["authenticate", "verifier"].sort());
    assert.ok(Object.isFrozen(h.authDomain));
    assert.ok(Object.isFrozen(h.authDomain.verifier));
    // No brand accessor of any kind:
    for (const k of ["brand", "sessionBrand", "getBrand", "sessions", "getSessions", "brandSet", "hasSession"]) {
        assert.equal(typeof h.authDomain[k], "undefined", `domain.${k} must not exist`);
    }
});

// ---------------------------------------------------------------------------
// STRUCTURAL SCANS — no auth bootstrap/mint/issuer/brand surface in src/action
// ---------------------------------------------------------------------------

test("structural: no action module exports auth bootstrap/mint/issuer/brand surfaces", () => {
    const dir = path.join(__dirname, "../../src/action");
    const FORBIDDEN = [
        "onReady",
        "bindAuthentication",
        "mintSession",
        "mintAuthSession",
        "issueIdentity",
        "issueSession",
        "createAuthSessionIssuer",
        "createSessionTrustDomain",
        "createGate",
        "sessionBrand",
        "authSessionBrands",
        "authBinder",
        "bootstrapCapability",
        "trustedBootstrap",
        "sessionBrandAccessor",
        "isAuthSession"
    ];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const name of FORBIDDEN) {
            assert.equal(typeof mod[name], "undefined", `${f} must not export ${name}`);
        }
    }
});

test("structural: source scan — no export binding for auth bootstrap/mint/issuer", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    const FORBIDDEN_NAMES = [
        "onReady", "bindAuthentication", "mintSession", "mintAuthSession",
        "issueIdentity", "issueSession", "createAuthSessionIssuer",
        "sessionBrand", "authSessionBrands", "authBinder"
    ];
    for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
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

test("structural: runtime constructor rejects EVERY caller-bootstrap option key", () => {
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: CLOCK });
    const store = createMemoryAuthorityStore();
    const authDomain = createAuthenticationDomain({ authenticate, clock: CLOCK });
    for (const key of ["onReady", "bindAuthentication", "mintSession", "issueIdentity", "issueSession", "issuer", "sessionIssuer", "sessionBrand", "authBrand", "authBinder", "bootstrap", "createAuthSessionIssuer", "authSessionIssuer", "bootstrapCapability", "trustedBootstrap"]) {
        assert.throws(
            () => createActionAuthorityRuntime({
                capabilityRuntime, authorityStore: store,
                authVerifier: authDomain.verifier,
                trustedScopeBindings: {}, clock: CLOCK,
                [key]: () => ({ mintSession: () => ({ principal: "victim" }) })
            }),
            (e) => e.reasonCode === "CALLER_BOOTSTRAP_REJECTED",
            `caller-bootstrap key '${key}' must be rejected at composition`
        );
    }
});

test("structural: no onReady/bindAuthentication/mintSession call sites remain in src/action", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    // Match live CALL SITES (option access, invocation), not the rejection
    // list array literal in runtime.js (which lists these names precisely to
    // REJECT them). `\bonReady\b` alone would match `onReady:` property access
    // or `onReady(` invocation; we exclude string-literal entries of the
    // CALLER_BOOTSTRAP_KEYS rejection list.
    const PATTERN = /\b(\w+)\s*\.\s*(onReady|bindAuthentication|mintSession|issueIdentity|createAuthSessionIssuer)\s*\(|\bonReady\s*:\s*(?!.*CALLER)|\bmintSession\s*\(.*\)/;
    for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        const noComments = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        // Also strip the rejection-list array literal lines (they enumerate the
        // forbidden names as STRINGS, which is the legitimate rejection code).
        const stripped = noComments.replace(/CALLER_BOOTSTRAP_KEYS\s*=\s*Object\.freeze\(\s*\[[\s\S]*?\]\s*\)/g, "");
        assert.ok(!PATTERN.test(stripped),
            `${f}: no live onReady/bindAuthentication/mintSession call site may exist`);
    }
});
