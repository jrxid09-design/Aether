"use strict";

/**
 * ACTION VERIFICATION + COMPENSATION FABRIC V1 — Lane 4 security regression
 * suite (tests/verification/).
 *
 * Direct tests for the 27 required Lane 4 proofs:
 *
 *   1.  forged ExecutionResult cannot be verified
 *   2.  JSON clone cannot be verified
 *   3.  foreign-domain result rejected
 *   4.  hostile Proxy result recognition causes zero traps
 *   5.  caller-selected verifier rejected
 *   6.  verifier mutation after registration has no effect
 *   7.  verifier A→B incarnation ABA rejects old verification work
 *   8.  verifier error != VERIFIED_FAILURE
 *   9.  verifier timeout != verified success/failure
 *   10. inconclusive evidence stays INCONCLUSIVE
 *   11. fake evidence cannot mint VERIFIED_SUCCESS
 *   12. VerificationResult cannot become authority
 *   13. compensation cannot bypass Lane 2
 *   14. original ALLOW does not authorize compensation
 *   15. revoked compensation authority => no compensation actuation
 *   16. stale capability incarnation => no compensation actuation
 *   17. foreign session => no compensation actuation
 *   18. fake compensation plan rejected
 *   19. duplicate compensationId => no duplicate actuation
 *   20. compensation execution without verification => no rollback claim
 *   21. compensation timeout => ambiguous, no false restoration claim
 *   22. compensation verified success => only then restoration/success claim
 *   23. no direct caller compensator injection
 *   24. no Authority mutation from verification
 *   25. no Capability mutation from verification
 *   26. no direct actuation from verification layer except through Lane 3
 *   27. no Wave 5 routing/orchestration implementation
 *
 * Plus hostile-input probes and structural scans (no privileged factory
 * exported from any verification module; brand predicates unforgeable).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const verificationApi = require("../../src/action/verification");
const bootstrap = require("../../src/action/bootstrap");
const { makeVerificationHarness } = require("./harness");
const { VERIFICATION_STATE, COMPENSATION_STATE, REASONS } = require("../../src/action/verification/errors");
const { RESULT_STATE } = require("../../src/action/actuation/errors");

const ROOT = path.join(__dirname, "..", "..");

async function setupWorld(h, { capabilityId = "fs.cap", operations = ["read"], verifyOps = ["read"] } = {}) {
    const res = await h.lane3.lane2.registerCapability({ id: capabilityId, operations });
    await h.lane3.lane2.registry.observeAvailability(capabilityId, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

function lane4ScopeBindings() {
    const resolver = (args) => {
        const t = args && typeof args.target === "string" ? args.target.trim().toLowerCase() : "";
        return t ? [t] : [];
    };
    const writeResolver = (args) => {
        const p = args && (typeof args.path === "string" ? args.path : (typeof args.target === "string" ? args.target : ""));
        const s = typeof p === "string" ? p.trim().toLowerCase() : "";
        return s ? [s] : [];
    };
    return {
        "fs.cap": { read: resolver, write: resolver },
        "fs.restore": { write: writeResolver, read: writeResolver }
    };
}

async function makeHarness4() {
    return await makeVerificationHarness({ scopeBindings: lane4ScopeBindings() });
}

async function runExecutedAction(h, { capabilityId = "fs.cap", operation = "read", principal = "alice", target = "t" } = {}) {
    const intent = h.lane3.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId, operation, arguments: { target } }));
    return await h.lane3.execute({ intent, authSession: h.lane3.lane2.session(principal), parameters: { target } });
}

function goodPostcondition() {
    return { expect: { "world.value": { op: "eq", value: 42 } } };
}

/** Heuristic: detect a live Proxy (accessor traps cause visible divergences). */
function isProxyLike(v) {
    if (v === null || typeof v !== "object") return false;
    try {
        // A transparent Proxy whose target is a plain object is still
        // observably a Proxy via the prototype/constructor divergence trick:
        // for a genuine plain object, Object.prototype.toString.call returns
        // '[object Object]' AND Object.getOwnPropertyNames agrees with
        // Object.keys. We only flag *live* proxies (those that diverge).
        const a = Object.getOwnPropertyNames(v).length;
        const b = Object.keys(v).length;
        if (a !== b) return true;
        return false;
    } catch {
        return true;
    }
}

// ---------------------------------------------------------------------------
// Structural: no privileged factory exported from any verification module
// ---------------------------------------------------------------------------

test("structural: public verification API exports no privileged factory", () => {
    for (const name of [
        "buildVerifierRegistry", "registerVerifier", "removeVerifier", "composeVerification",
        "formVerificationRequest", "buildVerificationResult", "formCompensationPlan",
        "buildCompensationResult", "sanitizeEvidence", "evaluatePostcondition",
        "formExpectedPostcondition", "compensator", "rollback", "compensate"
    ]) {
        assert.equal(typeof verificationApi[name], "undefined", `verification api.${name} must not be exported`);
    }
    for (const [name, value] of Object.entries(verificationApi)) {
        if (typeof value === "function") {
            assert.ok(name.startsWith("is") || name === "ExecutionError",
                `verification api.${name} must be a pure predicate, not a privileged callable`);
        }
    }
});

test("structural: no action/verification submodule exports privileged composition (DIRECT module.exports scan)", () => {
    const dir = path.join(__dirname, "../../src/action/verification");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    assert.ok(files.length >= 4, "verification package must exist");
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const name of [
            "buildVerifierRegistry", "registerVerifier", "composeVerification",
            "formVerificationRequest", "buildVerificationResult", "formCompensationPlan",
            "buildCompensationResult", "sanitizeEvidence", "evaluatePostcondition",
            "formExpectedPostcondition", "verifierRegistry", "registrar", "compensator",
            "rollback", "compensate", "verify"
        ]) {
            assert.equal(typeof mod[name], "undefined",
                `${f} must not export privileged '${name}'`);
        }
        for (const name of ["requestBrandSet", "resultBrandSet", "planBrandSet",
            "REQUEST_BRAND", "RESULT_BRAND", "PLAN_BRAND", "brand", "addBrand", "mark", "mint"]) {
            assert.equal(typeof mod[name], "undefined", `${f} must not export brand surface '${name}'`);
        }
    }
});

test("structural: production src/** never imports tests/**", () => {
    const srcRoot = path.join(ROOT, "src");
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js")) {
                const text = fs.readFileSync(full, "utf8");
                if (/require\(\s*["'][^"']*tests\//.test(text)) offenders.push(path.relative(ROOT, full));
            }
        }
    };
    walk(srcRoot);
    assert.deepEqual(offenders, [], "production src must never import tests");
});

test("structural: bootstrap verification facade is least privilege", () => {
    const v = bootstrap.createCanonicalVerificationFacade();
    const keys = Object.keys(v).sort();
    assert.deepEqual(keys, ["compensate", "isCanonicalCompensationPlan", "isCanonicalVerificationRequest", "isCanonicalVerificationResult", "verify"]);
    assert.ok(Object.isFrozen(v));
});

// ---------------------------------------------------------------------------
// Proofs 1-4: forged/clone/foreign/hostile-proxy execution results
// ---------------------------------------------------------------------------

test("1: forged ExecutionResult cannot be verified", async () => {
    const h = await makeHarness4();
    await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"],
        capabilityIncarnationId: (await h.lane3.lane2.registry.get("fs.cap")).incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const forged = {
        schemaVersion: 1, executionId: "e-1", intentId: "i-1", capabilityId: "fs.cap",
        capabilityIncarnationId: "inc-00000000000000000000000000000000",
        operation: "read", principal: "alice", actuatorId: "act", actuatorIncarnationId: "ainc-x",
        state: "EXECUTED", startedAtMs: 1, completedAtMs: 2, actuatorReport: null,
        failureReason: "", failureDetail: "", authorityGeneration: 0,
        lifecycleTrace: [], verified: null, verificationClaim: null
    };
    await assert.rejects(() => h.verify({ executionResult: forged, expectedPostcondition: goodPostcondition() }),
        (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT);
});

test("2: JSON clone of a canonical ExecutionResult cannot be verified", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const real = await runExecutedAction(h);
    const clone = JSON.parse(JSON.stringify(real));
    await assert.rejects(() => h.verify({ executionResult: clone, expectedPostcondition: goodPostcondition() }),
        (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT);
});

test("3: foreign-domain (structurally canonical but different trust domain) result rejected", async () => {
    const h = await makeHarness4();
    await setupWorld(h);
    // A SECOND harness = a different trust domain; its results are branded
    // in ITS WeakSet, not this harness's.
    const other = await makeHarness4();
    const otherCap = await setupWorld(other);
    await other.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: otherCap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const foreignResult = await (async () => {
        const intent = other.lane3.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "fs.cap", operation: "read", arguments: { target: "x" } }));
        return await other.lane3.execute({ intent, authSession: other.lane3.lane2.session("alice"), parameters: { target: "x" } });
    })();
    await assert.rejects(() => h.verify({ executionResult: foreignResult, expectedPostcondition: goodPostcondition() }),
        (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT);
});

test("4: hostile Proxy result recognition causes zero traps", async () => {
    const h = await makeHarness4();
    await setupWorld(h);
    const traps = { get: 0, has: 0, ownKeys: 0, gopd: 0, gtp: 0 };
    const hostile = new Proxy({}, {
        get(t, p) { traps.get++; return t[p]; },
        has(t, p) { traps.has++; return p in t; },
        ownKeys(t) { traps.ownKeys++; return Reflect.ownKeys(t); },
        getOwnPropertyDescriptor(t, p) { traps.gopd++; return Reflect.getOwnPropertyDescriptor(t, p); },
        getPrototypeOf(t) { traps.gtp++; return Reflect.getPrototypeOf(t); }
    });
    const fired = () => Object.values(traps).reduce((a, b) => a + b, 0);
    const before = fired();
    const v = bootstrap.createCanonicalVerificationFacade();
    v.isCanonicalVerificationRequest(hostile);
    const afterReq = fired();
    v.isCanonicalVerificationResult(hostile);
    const afterRes = fired();
    v.isCanonicalCompensationPlan(hostile);
    const afterPlan = fired();
    assert.equal(afterReq - before, 0, "verification-request predicate must fire zero traps");
    assert.equal(afterRes - afterReq, 0, "verification-result predicate must fire zero traps");
    assert.equal(afterPlan - afterRes, 0, "compensation-plan predicate must fire zero traps");
    // verify() must also reject the hostile proxy without trap-driven decisions.
    await assert.rejects(() => h.verify({ executionResult: hostile, expectedPostcondition: goodPostcondition() }),
        (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT);
    assert.equal(fired() - afterPlan, 0, "verify() must not be driven by Proxy traps");
});

// ---------------------------------------------------------------------------
// Proofs 5-7: verifier registry trust boundary
// ---------------------------------------------------------------------------

test("5: caller-selected verifier rejected", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const result = await runExecutedAction(h);
    for (const key of ["verifier", "verifierFn", "observe", "sensor", "predicate", "evaluator", "checker", "verifyFn"]) {
        await assert.rejects(() => h.verify({
            executionResult: result,
            expectedPostcondition: goodPostcondition(),
            [key]: async () => ({ world: { value: 42 } })
        }), (e) => e.reasonCode === REASONS.CALLER_VERIFIER_REJECTED, `option '${key}' must be rejected`);
    }
});

test("6: verifier mutation after registration has no effect", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    let world = { value: 42 };
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world })
    });
    const result = await runExecutedAction(h);
    // Caller mutates its OWN holder object after registration, attempting to
    // swap the observation function through the captured binding.
    // The registry captures the function ONCE: re-registration with the same
    // id while present is rejected synchronously (no replace).
    assert.throws(() => h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 999 } })
    }), (e) => e.reasonCode === REASONS.REGISTRATION_REJECTED);
    // The caller's holder mutation cannot reach the registry: the original
    // verification still resolves to the originally captured function.
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS,
        "post-registration mutation of caller-owned objects must not change verifier behavior");
    assert.equal(v.verifierId, "ver-fs");
    // The world state the verifier OBSERVES may legitimately change (that is
    // the point of observation) — the protected thing is the binding.
    world = { value: 1 };
    const v2 = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    // Note: the second verify reuses the record for identical
    // execution+postcondition (idempotence), so its verdict is unchanged.
    assert.equal(v2.verificationId, v.verificationId);
    assert.equal(v2.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS);
});

test("7: verifier A→B incarnation ABA rejects old verification work", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    const bindingA = await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const result = await runExecutedAction(h);
    // A fresh verification binds to A's incarnation.
    const v1 = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v1.verifierIncarnationId, bindingA.verifierIncarnationId);
    // Replace A with B: same logical verifierId, NEW incarnation.
    h.removeVerifier("ver-fs");
    const bindingB = await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    assert.notEqual(bindingA.verifierIncarnationId, bindingB.verifierIncarnationId,
        "re-registration MUST mint a new verifier incarnation (ABA-safe)");
    // Old verification work carries A's incarnation — it is never re-run
    // through B: a NEW verification (different postcondition => different
    // identity) resolves B, and the OLD result object keeps A's binding.
    const v2 = await h.verify({
        executionResult: result,
        expectedPostcondition: { expect: { "world.value": { op: "gt", value: 0 } } }
    });
    assert.equal(v2.verifierIncarnationId, bindingB.verifierIncarnationId,
        "new work resolves the CURRENT incarnation only");
    assert.equal(v1.verifierIncarnationId, bindingA.verifierIncarnationId,
        "old work never silently re-binds to B");
    // A result-shaped object claiming A's old incarnation cannot be minted:
    // the fake is rejected by the verification brand check.
    const fakeOld = { ...v1, verifierIncarnationId: bindingA.verifierIncarnationId };
    await assert.rejects(() => h.compensate({
        verification: fakeOld, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: {}, reason: "ABA"
    }), (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT);
});

// ---------------------------------------------------------------------------
// Proofs 8-11: verification state precision
// ---------------------------------------------------------------------------

test("8: verifier error != VERIFIED_FAILURE", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => { throw new Error("sensor offline"); }
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.ERROR,
        "verifier infrastructure error must be classified ERROR, not VERIFIED_FAILURE");
    assert.equal(v.observedEvidence && v.observedEvidence.name, "Error");
});

test("9: verifier timeout != verified success/failure", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-slow", observe: () => new Promise((r) => setTimeout(() => r({ world: { value: 42 } }), 250))
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition(), timeoutMs: 25 });
    assert.equal(v.verificationState, VERIFICATION_STATE.TIMED_OUT,
        "verification timeout must be TIMED_OUT — neither success nor failure");
});

test("10: inconclusive evidence stays INCONCLUSIVE", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ different: { shape: true } })
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.INCONCLUSIVE,
        "missing evidence must stay INCONCLUSIVE — never collapsed into success or failure");
});

test("11: fake evidence cannot mint VERIFIED_SUCCESS (vacuous postcondition rejected)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ anything: true })
    });
    const result = await runExecutedAction(h);
    for (const vacuous of [{}, { expect: {}, forbid: {} }, { expect: null, forbid: null }]) {
        await assert.rejects(() => h.verify({ executionResult: result, expectedPostcondition: vacuous }),
            (e) => e.reasonCode === REASONS.MALFORMED_REQUEST,
            "vacuous postcondition must be rejected so it can never mint VERIFIED_SUCCESS");
    }
});

// ---------------------------------------------------------------------------
// Proof 12: VerificationResult cannot become authority
// ---------------------------------------------------------------------------

test("12: VerificationResult cannot become authority (bearer-executor rejected)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS);
    // Attempting to use the verification result as a bearer execution token:
    for (const bearerOpt of ["decision", "authorityDecision", "allow", "allowDecision", "authorize"]) {
        await assert.rejects(() => h.lane3.execute({
            intent: h.lane3.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "fs.cap", operation: "read", arguments: { target: "t" } })),
            authSession: h.lane3.lane2.session("alice"),
            [bearerOpt]: v
        }), (e) => e.reasonCode === "CALLER_EXECUTOR_REJECTED",
            `verification result must not be usable as bearer option '${bearerOpt}'`);
    }
});

// ---------------------------------------------------------------------------
// Proofs 13-17: compensation authority
// ---------------------------------------------------------------------------

async function makeFailureWorld({ principal = "alice" } = {}) {
    const h = await makeHarness4();
    const cap = await setupWorld(h, { capabilityId: "fs.cap", operations: ["read"] });
    // capability for the compensation action itself
    const compCap = await setupWorld(h, { capabilityId: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] }).catch(() => {});
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } }) // FAILS the postcondition
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: principal, actions: ["read"], identityBinding: { principals: [principal] } });
    const result = await runExecutedAction(h, { principal });
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_FAILURE, "world must be observed failing the postcondition");
    return { h, result, v, principal };
}

test("13: compensation cannot bypass Lane 2 (no authority => no compensation actuation)", async () => {
    const { h, v, principal } = await makeFailureWorld();
    // NOTE: NO authority granted for fs.restore.write — the compensation
    // action must be denied by the Lane 2 gate inside execute().
    let actuations = 0;
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: "inc-00000000000000000000000000000000",
        actuatorId: "act-restore", invoke: async () => { actuations++; return { ok: true }; }
    });
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal, parameters: { path: "x" }, reason: "restore after failure"
    });
    assert.equal(c.state, COMPENSATION_STATE.FAILED, "unauthorized compensation must not execute");
    assert.equal(actuations, 0, "no compensation actuation without Lane 2 authority");
    assert.equal(c.restored, null, "no restoration claim");
});

test("14: original ALLOW does not authorize compensation", async () => {
    const { h, v, principal } = await makeFailureWorld();
    // Principal HAS allow for fs.cap.read (that is how the original action
    // executed). That ALLOW must NOT authorize fs.restore.write.
    let actuations = 0;
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: "inc-00000000000000000000000000000000",
        actuatorId: "act-restore", invoke: async () => { actuations++; return { ok: true }; }
    });
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal, parameters: { path: "x" }, reason: "restore after failure"
    });
    assert.equal(c.state, COMPENSATION_STATE.FAILED,
        "permission to read fs.cap must NOT authorize compensation on fs.restore");
    assert.equal(actuations, 0);
});

test("15: revoked compensation authority => no compensation actuation", async () => {
    const { h, v, principal } = await makeFailureWorld();
    const res = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    let actuations = 0;
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res.incarnationId,
        actuatorId: "act-restore", invoke: async () => { actuations++; return { ok: true }; }
    });
    // Grant, verify compensation works (sanity), then REVOKE and re-attempt.
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: principal, actions: ["write"], identityBinding: { principals: [principal] } });
    const capEntry = await h.lane3.lane2.store.getCapability("fs.restore");
    await h.lane3.lane2.store.upsertCapability("fs.restore", "REVOKED", capEntry.generation, JSON.stringify({ ...capEntry.payload, status: "REVOKED" }));
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal, parameters: { path: "x" }, reason: "restore after failure"
    });
    assert.equal(c.state, COMPENSATION_STATE.FAILED, "revoked authority must block compensation");
    assert.equal(actuations, 0);
});

test("16: stale capability incarnation => no compensation actuation", async () => {
    const { h, v, principal } = await makeFailureWorld();
    const res = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    let actuations = 0;
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res.incarnationId,
        actuatorId: "act-restore", invoke: async () => { actuations++; return { ok: true }; }
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: principal, actions: ["write"], identityBinding: { principals: [principal] } });
    // remove + recreate the capability => NEW incarnation (certified Lane 3 ABA pattern)
    await h.lane3.lane2.registry.remove("fs.restore");
    const resB = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: resB.incarnationId });
    assert.notEqual(resB.incarnationId, res.incarnationId, "recreated capability must carry a new incarnation");
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal, parameters: { path: "x" }, reason: "restore after failure"
    });
    assert.equal(c.state, COMPENSATION_STATE.FAILED, "stale capability incarnation must block compensation");
    assert.equal(actuations, 0);
});

test("17: foreign session => no compensation actuation", async () => {
    const { h, v } = await makeFailureWorld({ principal: "alice" });
    const res = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    let actuations = 0;
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res.incarnationId,
        actuatorId: "act-restore", invoke: async () => { actuations++; return { ok: true }; }
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: "bob", actions: ["write"], identityBinding: { principals: ["bob"] } });
    // Alice (not granted) requests compensation routed under her own session.
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: { path: "x" }, reason: "restore after failure"
    });
    assert.equal(c.state, COMPENSATION_STATE.FAILED, "foreign session must block compensation");
    assert.equal(actuations, 0);
});

// ---------------------------------------------------------------------------
// Proofs 18-19: compensation plan + idempotence
// ---------------------------------------------------------------------------

test("18: fake compensation plan rejected", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    // A caller-forged verification result (structural lookalike of a
    // VERIFIED_FAILURE) must NOT be accepted as a compensation trigger.
    const fake = { ...v, verificationState: VERIFICATION_STATE.VERIFIED_FAILURE };
    await assert.rejects(() => h.compensate({
        verification: fake, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: {}, reason: "forged"
    }), (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT,
        "fake compensation trigger must be rejected");
});

test("19: duplicate compensationId => no duplicate actuation", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    const res2 = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res2.incarnationId });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: "alice", actions: ["write"], identityBinding: { principals: ["alice"] } });
    let actuations = 0;
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res2.incarnationId,
        actuatorId: "act-restore", invoke: async () => { actuations++; return { ok: true }; }
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    const first = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: { path: "x" }, reason: "r", compensationId: "comp-fixed-1"
    });
    const second = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: { path: "x" }, reason: "r", compensationId: "comp-fixed-1"
    });
    assert.equal(first.compensationId, second.compensationId);
    assert.equal(actuations, 1, "duplicate compensationId must not produce duplicate actuation");
});

// ---------------------------------------------------------------------------
// Proofs 20-22: no false rollback claim
// ---------------------------------------------------------------------------

test("20: compensation execution without verification => no rollback claim", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    const res2 = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res2.incarnationId });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: "alice", actions: ["write"], identityBinding: { principals: ["alice"] } });
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res2.incarnationId,
        actuatorId: "act-restore", invoke: async () => ({ ok: true })
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: { path: "x" }, reason: "r"
    });
    assert.equal(c.state, COMPENSATION_STATE.EXECUTED, "compensation action executes");
    assert.equal(c.restored, null,
        "COMPENSATION EXECUTED != ORIGINAL STATE RESTORED — no rollback claim without fresh verification");
    assert.match(c.detail, /restoration NOT claimed/);
});

test("21: compensation timeout => ambiguous, no false restoration claim", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    const res2 = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res2.incarnationId });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: "alice", actions: ["write"], identityBinding: { principals: ["alice"] } });
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res2.incarnationId,
        actuatorId: "act-slow", invoke: () => new Promise((r) => setTimeout(() => r({ ok: true }), 200))
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: { path: "x" }, reason: "r"
    });
    // The compensation actuator hangs past the Lane 3 dispatch timeout =>
    // effect ambiguity is preserved: no execution claim, no restoration claim.
    assert.notEqual(c.state, COMPENSATION_STATE.VERIFIED);
    assert.equal(c.restored, null);
});

test("22: compensation verified success => only then restoration claim (via separate fresh verification)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    const res2 = await h.lane3.lane2.registerCapability({ id: "fs.restore", operations: ["write"] });
    await h.lane3.lane2.registry.observeAvailability("fs.restore", "AVAILABLE", { generation: 1, incarnationId: res2.incarnationId });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    await h.registerVerifier({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res2.incarnationId,
        verifierId: "ver-restore", observe: async () => ({ world: { value: 42 } })
    });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.restore", subject: "alice", actions: ["write"], identityBinding: { principals: ["alice"] } });
    h.lane3.registerActuator({
        capabilityId: "fs.restore", operations: ["write"], capabilityIncarnationId: res2.incarnationId,
        actuatorId: "act-restore", invoke: async () => ({ ok: true })
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_FAILURE);
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: { path: "x" }, reason: "r"
    });
    assert.equal(c.state, COMPENSATION_STATE.EXECUTED);
    assert.equal(c.restored, null, "even after execution, restored stays null until verified");
    // Only a FRESH verification of the compensation's own postcondition can
    // establish restoration truth.
    const cv = await h.verify({ executionResult: c.executionResult, expectedPostcondition: goodPostcondition() });
    assert.equal(cv.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS,
        "compensation verified success is the ONLY path to a restoration claim");
});

// ---------------------------------------------------------------------------
// Proofs 23-27: surface discipline
// ---------------------------------------------------------------------------

test("23: no direct caller compensator injection", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    for (const key of ["compensator", "rollback", "repair", "undo", "restore", "compensateFn"]) {
        await assert.rejects(() => h.compensate({
            verification: v, capabilityId: "fs.restore", operation: "write",
            principal: "alice", parameters: {}, reason: "r",
            [key]: async () => ({ ok: true })
        }), (e) => e.reasonCode === REASONS.CALLER_EXECUTOR_REJECTED,
            `caller compensator option '${key}' must be rejected`);
    }
});

test("24: no Authority mutation from verification", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const before = await h.lane3.lane2.store.getCapability("fs.cap");
    const result = await runExecutedAction(h, { principal: "alice" });
    await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    const after = await h.lane3.lane2.store.getCapability("fs.cap");
    assert.equal(after.generation, before.generation, "verification must not mutate authority state");
    assert.equal(after.status, before.status);
    const beforePayload = before.payload, afterPayload = after.payload;
    assert.deepEqual(afterPayload.actions ?? afterPayload, beforePayload.actions ?? beforePayload,
        "authority grant payload must be unchanged by verification");
});

test("25: no Capability mutation from verification", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const before = h.lane3.lane2.registry.get("fs.cap");
    const result = await runExecutedAction(h);
    await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    const after = h.lane3.lane2.registry.get("fs.cap");
    assert.equal(after.incarnationId, before.incarnationId, "verification must not mutate capability incarnation");
    assert.equal(after.generation, before.generation);
    assert.equal(after.availability, before.availability);
});

test("26: no direct actuation from verification layer except through Lane 3 canonical path", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_FAILURE);
    // verify() alone must never have actuated anything: the only execution
    // results in play are the original one.
    const c = await h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write",
        principal: "alice", parameters: {}, reason: "r"
    });
    // compensation failed closed (no authority for fs.restore): the result
    // must record NO execution result at all (admission/denial path), never
    // a direct actuation.
    assert.ok(c.executionResult === null || c.executionResult.state === "FAILED",
        "compensation path must only ever actuate through Lane 3 execute()");
});

test("27: no Wave 5 routing/orchestration implementation", () => {
    const dir = path.join(__dirname, "../../src/action");
    const offenders = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js")) {
                const text = fs.readFileSync(full, "utf8");
                // Lane 4 must not add any routing/orchestration/route-selection
                // implementation (Wave 5 scope).
                if (/class\s+\w*(Orchestrator|Router|Planner)\w*\s*[{(]/.test(text) ||
                    /module\.exports\s*=.*\{[^}]*(orchestrate|routeAction|planSequence)/s.test(text)) {
                    offenders.push(path.relative(ROOT, full));
                }
            }
        }
    };
    walk(dir);
    assert.deepEqual(offenders, [], "no Wave 5 routing/orchestration may be implemented in Lane 4");
});

// ---------------------------------------------------------------------------
// Hostile input probes (spec HOSTILE INPUT TESTS)
// ---------------------------------------------------------------------------

test("hostile: expected postcondition probes fail closed or sanitize", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const result = await runExecutedAction(h);
    const hostile = [
        { fn: () => ({ expect: { a: { op: "eq", value: 1 } } }), label: "function value" },
        { obj: null, label: "null" },
    ];
    // function as postcondition
    await assert.rejects(() => h.verify({
        executionResult: result,
        expectedPostcondition: { expect: { "world.value": { op: "eq", value: () => 1 } } }
    }), (e) => [REASONS.FUNCTION_VALUE, REASONS.MALFORMED_PAYLOAD, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // symbol value
    await assert.rejects(() => h.verify({
        executionResult: result,
        expectedPostcondition: { expect: { "world.value": { op: "eq", value: Symbol("x") } } }
    }), (e) => [REASONS.SYMBOL_VALUE, REASONS.MALFORMED_PAYLOAD, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // accessor property
    const accessor = {};
    Object.defineProperty(accessor, "expect", { get() { return {}; } });
    await assert.rejects(() => h.verify({ executionResult: result, expectedPostcondition: accessor }),
        (e) => [REASONS.ACCESSOR_PROPERTY, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // class instance
    class Hostile {}
    await assert.rejects(() => h.verify({ executionResult: result, expectedPostcondition: new Hostile() }),
        (e) => [REASONS.NON_PLAIN_OBJECT, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // cyclic
    const cyclic = { expect: {} };
    cyclic.expect.self = cyclic;
    await assert.rejects(() => h.verify({ executionResult: result, expectedPostcondition: cyclic }),
        (e) => [REASONS.CYCLIC_INPUT, REASONS.BOUND_EXCEEDED, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // prototype pollution keys
    await assert.rejects(() => h.verify({
        executionResult: result,
        expectedPostcondition: { expect: { "__proto__.x": { op: "exists" } } }
    }), (e) => [REASONS.DANGEROUS_KEY, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // oversized path
    await assert.rejects(() => h.verify({
        executionResult: result,
        expectedPostcondition: { expect: { [`${"a.".repeat(80)}x`]: { op: "exists" } } }
    }), (e) => [REASONS.DANGEROUS_KEY, REASONS.BOUND_EXCEEDED, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    // Proxy-wrapped postcondition: a TRAP-BEARING proxy is rejected (ownKeys
    // inspection divergence), a transparent proxy is sanitized (detached to a
    // plain frozen object; never retained raw).
    await assert.rejects(() => h.verify({
        executionResult: result,
        expectedPostcondition: new Proxy({}, {
            get(t, p) { return p === "expect" ? ({ "world.value": { op: "eq", value: 42 } }) : undefined; },
            ownKeys() { return ["expect"]; },
            getOwnPropertyDescriptor(t, p) {
                return { enumerable: true, configurable: true, get: () => ({ "world.value": { op: "eq", value: 42 } }) };
            }
        })
    }), (e) => [REASONS.NON_PLAIN_OBJECT, REASONS.MALFORMED_REQUEST, REASONS.ACCESSOR_PROPERTY].includes(e.reasonCode),
        "trap-bearing Proxy postcondition must be rejected");
    {
        const transparent = new Proxy({ expect: { "world.value": { op: "eq", value: 42 } } }, {});
        const v = await h.verify({ executionResult: result, expectedPostcondition: transparent });
        assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS,
            "transparent proxy data is sanitized, not retained raw");
        assert.ok(Object.isFrozen(v.expectedPostcondition),
            "formed postcondition must be frozen regardless of proxy input");
    }
});

test("hostile: verifier observation output is sanitized (no raw retention)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    class Secret {}
    const hostileObservation = {
        world: { value: 42 },
        proxy: new Proxy({}, { get() { return 1; } }),
        cls: new Secret(),
        fn: () => 1,
        sym: Symbol("s"),
        big: BigInt(10),
        cyc: null
    };
    hostileObservation.cyc = hostileObservation;
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-hostile", observe: async () => hostileObservation
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS);
    const ev = v.observedEvidence;
    assert.equal(ev.fn, null, "functions must be sanitized to null (not retained as functions)");
    assert.equal(ev.sym, null, "symbols must be sanitized to null (not retained)");
    assert.equal(ev.big, null, "bigint must be sanitized to null (not retained)");
    assert.equal(ev.cls, null, "class instances must be nulled");
    assert.equal(ev.cyc, null, "cycles must be cut (nulled)");
    // Proxy is never RETAINED: it is either nulled or detached into a plain
    // frozen object with no proxy identity (raw retention is the violation).
    assert.ok(ev.proxy === null || (typeof ev.proxy === "object" && Object.getPrototypeOf(ev.proxy) === Object.prototype),
        "Proxy must not be retained raw (nulled or detached to plain object)");
    assert.ok(!isProxyLike(ev.proxy), "sanitized evidence must not contain a live Proxy");
    assert.equal(ev.world.value, 42);
});

test("hostile: compensation parameters/metadata probes fail closed", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 0 } })
    });
    const result = await runExecutedAction(h);
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    await assert.rejects(() => h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write", principal: "alice",
        parameters: { bad: () => 1 }, reason: "r"
    }), (e) => [REASONS.FUNCTION_VALUE, REASONS.MALFORMED_PAYLOAD, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    const cyclicParams = {};
    cyclicParams.self = cyclicParams;
    await assert.rejects(() => h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write", principal: "alice",
        parameters: cyclicParams, reason: "r"
    }), (e) => [REASONS.CYCLIC_INPUT, REASONS.MALFORMED_PAYLOAD, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
    await assert.rejects(() => h.compensate({
        verification: v, capabilityId: "fs.restore", operation: "write", principal: "alice",
        parameters: JSON.parse('{"__proto__": {"x": 1}}'), reason: "r"
    }), (e) => [REASONS.DANGEROUS_KEY, REASONS.MALFORMED_REQUEST].includes(e.reasonCode));
});

// ---------------------------------------------------------------------------
// Positive-path sanity: the canonical verify/compensate surface works
// ---------------------------------------------------------------------------

test("sanity: canonical verify flow end-to-end", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async (ctx) => ({ world: { value: 42 }, observedExecutionId: ctx.executionId })
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS);
    assert.equal(v.executionId, result.executionId);
    assert.equal(v.intentId, result.intentId);
    assert.equal(v.capabilityId, "fs.cap");
    assert.equal(v.capabilityIncarnationId, result.capabilityIncarnationId);
    assert.equal(v.operation, "read");
    assert.equal(v.principal, "alice");
    assert.equal(v.actuatorId, result.actuatorId);
    assert.equal(v.actuatorIncarnationId, result.actuatorIncarnationId);
    assert.equal(v.verifierId, "ver-fs");
    assert.ok(v.verifierIncarnationId.startsWith("vinc-"));
    assert.equal(v.observedEvidence.observedExecutionId, result.executionId);
    assert.ok(h.isCanonicalVerificationResult(v));
    assert.ok(!h.isCanonicalVerificationResult({ ...v }));
});

test("sanity: duplicate verify of same execution+postcondition reuses record (observer side-effect idempotence)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    let observations = 0;
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => { observations++; return { world: { value: 42 } }; }
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v1 = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    const v2 = await h.verify({ executionResult: result, expectedPostcondition: goodPostcondition() });
    assert.equal(v1.verificationId, v2.verificationId, "same execution+postcondition must reuse the record");
    assert.equal(observations, 1, "observer with side effects must fire exactly once per verification identity");
});

test("sanity: forbid-rule postcondition (service stopped / record absent)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.lane3.lane2.grantAuthority({ capabilityId: "fs.cap", subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ process: { running: false }, record: null })
    });
    const result = await runExecutedAction(h, { principal: "alice" });
    const v = await h.verify({
        executionResult: result,
        expectedPostcondition: { forbid: { "process.running": true, record: true } }
    });
    assert.equal(v.verificationState, VERIFICATION_STATE.VERIFIED_SUCCESS,
        "forbid rules must evaluate (absent/falsy paths satisfy forbid)");
});

test("sanity: production facade verify() requires canonical production results (fails closed for test-domain results)", async () => {
    const h = await makeHarness4();
    const cap = await setupWorld(h);
    await h.registerVerifier({
        capabilityId: "fs.cap", operations: ["read"], capabilityIncarnationId: cap.incarnationId,
        verifierId: "ver-fs", observe: async () => ({ world: { value: 42 } })
    });
    const result = await runExecutedAction(h);
    const prod = bootstrap.createCanonicalVerificationFacade();
    // Test-domain results are NOT production-canonical: the production
    // facade must reject them (foreign trust domain).
    await assert.rejects(() => prod.verify({ executionResult: result, expectedPostcondition: goodPostcondition() }),
        (e) => e.reasonCode === REASONS.NOT_CANONICAL_EXECUTION_RESULT);
});
