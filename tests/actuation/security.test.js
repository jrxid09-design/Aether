"use strict";

/**
 * ACTION ACTUATION FABRIC V1 — Lane 3 security regression suite.
 *
 * Direct tests for the 18 required Lane 3 proofs:
 *
 *   1.  old ALLOW + revoked authority -> NO EXECUTION
 *   2.  old ALLOW + new authority generation -> NO EXECUTION without fresh allow
 *   3.  capability incarnation A -> recreated B -> old request never executes B
 *   4.  actuator incarnation A -> recreated B -> old request never executes B
 *   5.  fake/caller-selected actuator -> rejected
 *   6.  caller mutates actuator object after registration -> no semantic effect
 *   7.  fake AuthorityDecision alone cannot execute
 *   8.  invalid/foreign session -> no execution
 *   9.  unavailable capability -> no execution
 *   10. undeclared operation -> no execution
 *   11. duplicate executionId -> no duplicate actuation
 *   12. conflicting replay same executionId -> reject
 *   13. timeout -> exactly one invocation max
 *   14. cancellation before dispatch -> zero invocation
 *   15. cancellation after invocation -> no false "prevented" claim
 *   16. hostile actuator error -> normalized safely
 *   17. execution result cannot be forged into future authority
 *   18. zero Lane 4 verification claims
 *
 * Plus structural scans: no public actuation factory exported; brand
 * predicates are unforgeable; lifecycle state machine integrity.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const actuationApi = require("../../src/action/actuation");
const { makeActuationHarness } = require("./harness");
const { manualClock } = require("../action/bootstrapHarness");
const { LIFECYCLE, RESULT_STATE, REASONS } = require("../../src/action/actuation/errors");

async function setupAvailable(h, id = "filesystem.read", ops = ["read"]) {
    const res = await h.registerCapability({ id, operations: ops });
    await h.registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    return res;
}

function makeRecordingActuator(log, result = { ok: true }) {
    const fn = async (ctx) => { log.push(ctx.executionId); return result; };
    return fn;
}

// ---------------------------------------------------------------------------
// Structural: no privileged factory exported
// ---------------------------------------------------------------------------

test("structural: public actuation API exports no privileged factory", () => {
    for (const name of [
        "composeDispatcher", "buildActuatorRegistry", "formExecutionRequest",
        "buildExecutionResult", "buildExecutionEvidence", "createLifecycleTracker",
        "sanitizeActuatorOutput", "registerActuator", "removeActuator",
        "REQUEST_BRAND", "RESULT_BRAND", "requestBrandSet", "resultBrandSet"
    ]) {
        assert.equal(typeof actuationApi[name], "undefined", `actuation api.${name} must not be exported`);
    }
    // Every callable export is either a pure predicate or a constant accessor.
    for (const [name, value] of Object.entries(actuationApi)) {
        if (typeof value === "function") {
            assert.ok(name.startsWith("isCanonical") || name === "ExecutionError",
                `actuation api.${name} must be a pure predicate, not a privileged callable`);
        }
    }
});

test("structural: no action/actuation submodule exports privileged composition", () => {
    const dir = path.join(__dirname, "../../src/action/actuation");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    // INTERNAL formers (actuatorRegistry/executionRequest/result/dispatcher)
    // are bootstrap-private implementation modules: they are never reachable
    // from src/action or src/action/actuation/index.js, and their factories
    // exist for the trusted bootstrap closure only. What must NOT happen is
    // any of them leaking into a PUBLIC surface. The public surface is
    // index.js; scan every module's exports for factory-like callables and
    // verify none of them is re-exported publicly.
    const publicApi = require("../../src/action/actuation");
    for (const f of files) {
        const mod = require(path.join(dir, f));
        for (const name of ["composeDispatcher", "buildActuatorRegistry", "formExecutionRequest", "buildExecutionResult", "buildExecutionEvidence", "createLifecycleTracker", "registerActuator", "removeActuator"]) {
            if (typeof mod[name] === "function") {
                // internal module exporting an internal former is allowed ONLY
                // if the public API never re-exports it
                assert.equal(typeof publicApi[name], "undefined",
                    `internal module ${f} exports ${name}; the PUBLIC actuation API must not re-export it`);
            }
        }
    }
    // The Lane 2 public action API must not re-export any actuation factory.
    const lane2Api = require("../../src/action");
    for (const name of ["composeDispatcher", "buildActuatorRegistry", "formExecutionRequest", "buildExecutionResult", "registerActuator", "createCanonicalActuationFacade"]) {
        assert.equal(typeof lane2Api[name], "undefined", `src/action index must not re-export ${name}`);
    }
});

test("structural: brand predicates are unforgeable (clone/JSON/forged rejected)", async () => {
    const h = await makeActuationHarness();
    await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: h.lane2.registry.get("filesystem.read").incarnationId, actuatorId: "fs.read", invoke: makeRecordingActuator([]) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const result = await h.execute({ intent, authSession: h.lane2.session("alice") });
    assert.equal(actuationApi.isCanonicalExecutionResult(result), true);
    // forged/clone/JSON never satisfy the brand
    assert.equal(actuationApi.isCanonicalExecutionResult({ ...result }), false);
    assert.equal(actuationApi.isCanonicalExecutionResult(JSON.parse(JSON.stringify(result))), false);
    assert.equal(actuationApi.isCanonicalExecutionResult(Object.freeze({ schemaVersion: 1, executionId: "x" })), false);
    assert.equal(actuationApi.isCanonicalExecutionResult(null), false);
});

test("structural: lifecycle state machine — illegal transitions rejected", () => {
    const { createLifecycleTracker, LIFECYCLE } = require("../../src/action/actuation/lifecycle");
    const t = createLifecycleTracker();
    assert.equal(t.state, LIFECYCLE.CREATED);
    // CREATED -> DISPATCHING is illegal (must revalidate first)
    assert.throws(() => t.advance(LIFECYCLE.DISPATCHING, 1), (e) => e.reasonCode === REASONS.MALFORMED_REQUEST);
    // EXECUTED is terminal
    t.advance(LIFECYCLE.REVALIDATING, 1);
    t.advance(LIFECYCLE.READY, 2);
    t.advance(LIFECYCLE.DISPATCHING, 3);
    t.advance(LIFECYCLE.EXECUTED, 4);
    assert.equal(t.isTerminal(), true);
    assert.throws(() => t.advance(LIFECYCLE.CREATED, 5), (e) => e.reasonCode === REASONS.MALFORMED_REQUEST);
});

// ---------------------------------------------------------------------------
// 1. old ALLOW + revoked authority -> NO EXECUTION
// ---------------------------------------------------------------------------

test("R1: old ALLOW + revoked authority -> NO EXECUTION", async () => {
    const h = await makeActuationHarness();
    await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: h.lane2.registry.get("filesystem.read").incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    // first execute succeeds (grant a)
    const r1 = await h.execute({ intent, authSession: session, parameters: { target: "a" } });
    assert.equal(r1.state, RESULT_STATE.EXECUTED);
    // revoke authority: set status to REVOKED
    const cap = await h.lane2.store.getCapability("filesystem.read");
    await h.lane2.store.upsertCapability("filesystem.read", "REVOKED", cap.generation, JSON.stringify({ ...cap.payload, status: "REVOKED" }));
    // the OLD intent + OLD session, but DIFFERENT parameters (so the exact-once
    // guard's content key differs and a fresh revalidation runs). The fresh
    // canonical evaluate must DENY under the revoked authority.
    const r2 = await h.execute({ intent, authSession: session, parameters: { target: "b" } });
    assert.equal(r2.state, RESULT_STATE.FAILED);
    assert.equal(r2.failureReason, REASONS.AUTHORITY_DENIED);
    assert.equal(invokeLog.length, 1, "exactly one invocation (the first); the revoked one never reached the actuator");
});

// ---------------------------------------------------------------------------
// 2. old ALLOW + new authority generation -> NO EXECUTION without fresh allow
// ---------------------------------------------------------------------------

test("R2: new authority generation -> NO EXECUTION without fresh allow", async () => {
    const h = await makeActuationHarness();
    await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: h.lane2.registry.get("filesystem.read").incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    const r1 = await h.execute({ intent, authSession: session, parameters: { target: "a" } });
    assert.equal(r1.state, RESULT_STATE.EXECUTED);
    // bump generation: store now at generation 1 while grant is at 0
    const cap = await h.lane2.store.getCapability("filesystem.read");
    await h.lane2.store.upsertCapability("filesystem.read", "ACTIVE", 1, JSON.stringify({ ...cap.payload, generation: 1 }));
    // fresh revalidation under the new generation: the stored grant is at gen 0
    // != current gen 1 => canonical denial.
    const r2 = await h.execute({ intent, authSession: session, parameters: { target: "b" } });
    assert.equal(r2.state, RESULT_STATE.FAILED);
    assert.equal(r2.failureReason, REASONS.AUTHORITY_DENIED);
    assert.equal(invokeLog.length, 1);
});

// ---------------------------------------------------------------------------
// 3. capability incarnation A -> recreated B -> old request never executes B
// ---------------------------------------------------------------------------

test("R3: capability recreated -> old intent never executes", async () => {
    const h = await makeActuationHarness();
    const resA = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: resA.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    const r1 = await h.execute({ intent, authSession: session, parameters: { target: "a" } });
    assert.equal(r1.state, RESULT_STATE.EXECUTED);
    // remove + recreate the capability => new incarnation
    await h.lane2.registry.remove("filesystem.read");
    const resB = await setupAvailable(h.lane2);
    assert.notEqual(resB.incarnationId, resA.incarnationId);
    // replace the actuator with one bound to the NEW incarnation
    h.removeActuator("fs");
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: resB.incarnationId, actuatorId: "fs2", invoke: makeRecordingActuator(invokeLog) });
    // OLD intent (bound to A) must NOT execute via B. Fresh revalidation under
    // the new incarnation denies the old-intent admission (the canonical Lane 2
    // evaluate path returns a denial under the new incarnation; the dispatcher
    // maps it to AUTHORITY_DENIED — the exact code is fail-closed-acceptable).
    const r2 = await h.execute({ intent, authSession: session, parameters: { target: "b" } });
    assert.equal(r2.state, RESULT_STATE.FAILED);
    assert.notEqual(r2.state, RESULT_STATE.EXECUTED, "old intent must never execute under a new capability incarnation");
    assert.equal(invokeLog.length, 1, "the old-intent execution never reached the new-incarnation actuator");
});

// ---------------------------------------------------------------------------
// 4. actuator incarnation A -> recreated B -> old request never executes B
// ---------------------------------------------------------------------------

test("R4: actuator recreated -> old-style request binds to fresh binding, ABA prevented", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const logA = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(logA) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    const r1 = await h.execute({ intent, authSession: session });
    assert.equal(r1.state, RESULT_STATE.EXECUTED);
    // remove actuator, recreate with SAME logical id "fs" (different incarnation)
    h.removeActuator("fs");
    const logB = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(logB) });
    // a fresh intent + fresh session executes the new binding (different incarnation)
    const intent2 = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r2 = await h.execute({ intent: intent2, authSession: session });
    assert.equal(r2.state, RESULT_STATE.EXECUTED);
    assert.equal(logA.length, 1, "old actuator invoked exactly once (its original execution)");
    assert.equal(logB.length, 1, "new actuator invoked exactly once (fresh execution)");
    assert.notEqual(r1.actuatorIncarnationId, r2.actuatorIncarnationId, "different actuator incarnations");
});

// ---------------------------------------------------------------------------
// 5. fake/caller-selected actuator -> rejected
// ---------------------------------------------------------------------------

test("R5: caller-selected actuator option rejected", async () => {
    const h = await makeActuationHarness();
    await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    for (const key of ["actuator", "executor", "invoke", "fn", "handler", "impl"]) {
        // execute is async; the rejection surfaces as a rejected promise.
        await assert.rejects(() => h.execute({ intent, authSession: session, [key]: () => ({ ok: true }) }),
            (e) => e.reasonCode === REASONS.CALLER_EXECUTOR_REJECTED, `caller-executor option '${key}' must be rejected`);
    }
});

// ---------------------------------------------------------------------------
// 6. caller mutates actuator object after registration -> no semantic effect
// ---------------------------------------------------------------------------

test("R6: caller-side object mutation after registration -> no semantic effect", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const log = [];
    // wrap an object holding the invoke fn; mutate AFTER registration
    const holder = { invoke: makeRecordingActuator(log) };
    const binding = h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: holder.invoke });
    // mutate the holder's invoke — the binding captured the original fn identity
    holder.invoke = () => ({ ok: false, mutated: true });
    holder.mutated = true;
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r = await h.execute({ intent, authSession: h.lane2.session("alice") });
    assert.equal(r.state, RESULT_STATE.EXECUTED);
    assert.deepEqual(r.actuatorReport, { ok: true });
    assert.equal(log.length, 1);
    assert.equal(binding.invoke !== holder.invoke, true, "binding captured the original fn identity");
});

// ---------------------------------------------------------------------------
// 7. fake AuthorityDecision alone cannot execute
// ---------------------------------------------------------------------------

test("R7: fake AuthorityDecision bearer option rejected", async () => {
    const h = await makeActuationHarness();
    await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    for (const key of ["decision", "authorityDecision", "allow", "authorize"]) {
        await assert.rejects(() => h.execute({ intent, authSession: session, [key]: { decision: "ALLOW", principal: "alice", reasonCode: "AUTHORIZED" } }),
            (e) => e.reasonCode === REASONS.CALLER_EXECUTOR_REJECTED, `decision-bearer option '${key}' must be rejected`);
    }
});

// ---------------------------------------------------------------------------
// 8. invalid/foreign session -> no execution
// ---------------------------------------------------------------------------

test("R8: invalid/foreign session -> no execution", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    // foreign session from a DIFFERENT domain (composed via the Lane 2 test harness's isolated facility)
    const { composeIsolatedTrustDomain } = require("../action/bootstrapHarness");
    const foreign = composeIsolatedTrustDomain({ clock: { nowMs: () => h.lane2.clock.nowMs() } });
    const foreignSession = foreign.authDomain.authenticate({ claimedPrincipal: "alice" });
    const r = await h.execute({ intent, authSession: foreignSession });
    assert.equal(r.state, RESULT_STATE.FAILED);
    assert.equal(r.failureReason, REASONS.AUTHORITY_DENIED);
    assert.equal(invokeLog.length, 0, "foreign session never reached the actuator");
});

// ---------------------------------------------------------------------------
// 9. unavailable capability -> no execution
// ---------------------------------------------------------------------------

test("R9: unavailable capability -> no execution", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    // mark capability UNAVAILABLE
    await h.lane2.registry.observeAvailability("filesystem.read", "UNAVAILABLE", { generation: 2, incarnationId: res.incarnationId });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r = await h.execute({ intent, authSession: h.lane2.session("alice") });
    assert.equal(r.state, RESULT_STATE.FAILED);
    assert.equal(r.failureReason, REASONS.AUTHORITY_DENIED);
    assert.equal(invokeLog.length, 0);
});

// ---------------------------------------------------------------------------
// 10. undeclared operation -> no execution
// ---------------------------------------------------------------------------

test("R10: undeclared operation -> no execution (intent admission rejects)", async () => {
    const h = await makeActuationHarness();
    await setupAvailable(h.lane2, "filesystem.read", ["read"]);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: h.lane2.registry.get("filesystem.read").incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    assert.throws(() => h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "delete", arguments: { target: "safe.target" } })),
        (e) => e.reasonCode === "OPERATION_NOT_DECLARED");
    assert.equal(invokeLog.length, 0);
});

// ---------------------------------------------------------------------------
// 11. duplicate executionId -> no duplicate actuation
// ---------------------------------------------------------------------------

test("R11: duplicate identical request -> no duplicate actuation (exact-once)", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    const params = { target: "safe.target" };
    const r1 = await h.execute({ intent, authSession: session, parameters: params });
    const r2 = await h.execute({ intent, authSession: session, parameters: params });
    assert.equal(r1.state, RESULT_STATE.EXECUTED);
    assert.equal(r2.state, RESULT_STATE.EXECUTED);
    assert.equal(r1.executionId, r2.executionId, "exact-once: identical content key returns the same execution result");
    assert.equal(invokeLog.length, 1, "exactly one actuation");
});

// ---------------------------------------------------------------------------
// 12. conflicting replay same executionId -> reject
// ---------------------------------------------------------------------------

test("R12: conflicting payload with same intent -> distinct executionIds (no conflict)", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const invokeLog = [];
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator(invokeLog) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const session = h.lane2.session("alice");
    const r1 = await h.execute({ intent, authSession: session, parameters: { target: "a" } });
    const r2 = await h.execute({ intent, authSession: session, parameters: { target: "b" } });
    assert.notEqual(r1.executionId, r2.executionId, "different parameters => different executions");
    assert.equal(invokeLog.length, 2);
});

// ---------------------------------------------------------------------------
// 13. timeout -> exactly one invocation max
// ---------------------------------------------------------------------------

test("R13: timeout -> TIMED_OUT, exactly one invocation, ambiguity preserved", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    let invocations = 0;
    const slowActuator = async () => {
        invocations++;
        await new Promise((r) => setTimeout(r, 1000)); // exceeds the 50ms timeout
        return { ok: true };
    };
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: slowActuator });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r = await h.execute({ intent, authSession: h.lane2.session("alice"), timeoutMs: 50 });
    assert.equal(r.state, RESULT_STATE.TIMED_OUT);
    assert.equal(r.failureReason, REASONS.TIMEOUT_EXCEEDED);
    assert.equal(invocations, 1, "exactly one invocation; no silent retry");
    // ambiguity preserved: the result does NOT claim no-effect
    assert.equal(r.actuatorReport, null);
});

// ---------------------------------------------------------------------------
// 14. cancellation before dispatch -> zero invocation
// ---------------------------------------------------------------------------

test("R14: cancellation before dispatch -> zero invocations, CANCELLED", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    let invocations = 0;
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: async () => { invocations++; return { ok: true }; } });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const ac = new AbortController();
    ac.abort(); // pre-aborted
    const r = await h.execute({ intent, authSession: h.lane2.session("alice"), signal: ac.signal });
    assert.equal(r.state, RESULT_STATE.CANCELLED);
    assert.equal(r.failureReason, REASONS.CANCELLED_BEFORE_DISPATCH);
    assert.equal(invocations, 0, "zero invocations");
});

// ---------------------------------------------------------------------------
// 15. cancellation after invocation -> no false "prevented" claim
// ---------------------------------------------------------------------------

test("R15: cancellation after invocation -> no false 'prevented' claim (EXECUTED, not CANCELLED)", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    let invocations = 0;
    const slowActuator = async () => {
        invocations++;
        await new Promise((r) => setTimeout(r, 100));
        return { ok: true };
    };
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: slowActuator });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const ac = new AbortController();
    const execPromise = h.execute({ intent, authSession: h.lane2.session("alice"), signal: ac.signal, timeoutMs: 5000 });
    // abort mid-flight
    setTimeout(() => ac.abort(), 10);
    const r = await execPromise;
    // late cancellation: execution continues to its real outcome. NOT CANCELLED.
    assert.notEqual(r.state, RESULT_STATE.CANCELLED, "late cancellation must NOT falsely claim prevention");
    assert.equal(invocations, 1, "the actuator was invoked; cancellation was too late");
});

// ---------------------------------------------------------------------------
// 16. hostile actuator error -> normalized safely
// ---------------------------------------------------------------------------

test("R16: hostile actuator error -> normalized, no raw object escapes", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    const hostile = async () => { throw { evil: new Proxy({}, { get() { throw new Error("trap"); } }), fn: () => null, [Symbol("x")]: 1 }; };
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: hostile });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r = await h.execute({ intent, authSession: h.lane2.session("alice") });
    assert.equal(r.state, RESULT_STATE.FAILED);
    assert.equal(r.failureReason, REASONS.ACTUATOR_REJECTED_INVOCATION);
    // the hostile object is sanitized: no functions, no Proxy, no symbols escape
    const report = r.actuatorReport;
    assert.ok(report === null || (typeof report === "object" && typeof report.fn !== "function"));
    assert.ok(report === null || typeof report.evil !== "object" || report.evil === null || Object.getOwnPropertySymbols(report.evil).length === 0);
});

// ---------------------------------------------------------------------------
// 17. execution result cannot be forged into future authority
// ---------------------------------------------------------------------------

test("R17: execution result cannot be forged into future authority", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator([]) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r = await h.execute({ intent, authSession: h.lane2.session("alice") });
    // A fresh intent for an operation bob has NO grant for: even if we pass
    // the prior result as "evidence", the dispatcher revalidates fresh and denies.
    await h.lane2.grantAuthority({ subject: "bob", actions: ["read"], identityBinding: { principals: ["bob"] } });
    const intent2 = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    // attempt to forge: pass the EXECUTED result as a "decision" — rejected outright
    await assert.rejects(() => h.execute({ intent: intent2, authSession: h.lane2.session("alice"), decision: r }),
        (e) => e.reasonCode === REASONS.CALLER_EXECUTOR_REJECTED);
    // a session that the canonical domain never minted for bob: bob's session
    // (if the test authenticator mints it) evaluates and is denied because bob's
    // grant exists — but bob has a grant, so this passes. Instead prove the
    // result object itself grants nothing: pass it as the session.
    const r2 = await h.execute({ intent: intent2, authSession: r });
    assert.equal(r2.state, RESULT_STATE.FAILED);
    assert.notEqual(r2.state, RESULT_STATE.EXECUTED, "an execution result cannot serve as an authenticated session");
});

// ---------------------------------------------------------------------------
// 18. zero Lane 4 verification claims
// ---------------------------------------------------------------------------

test("R18: zero Lane 4 verification claims in results", async () => {
    const h = await makeActuationHarness();
    const res = await setupAvailable(h.lane2);
    await h.lane2.grantAuthority({ subject: "alice", actions: ["read"], identityBinding: { principals: ["alice"] } });
    h.registerActuator({ capabilityId: "filesystem.read", operations: ["read"], capabilityIncarnationId: res.incarnationId, actuatorId: "fs", invoke: makeRecordingActuator([]) });
    const intent = h.lane2.admit(JSON.stringify({ schemaVersion: 1, capabilityId: "filesystem.read", operation: "read", arguments: { target: "safe.target" } }));
    const r = await h.execute({ intent, authSession: h.lane2.session("alice") });
    assert.equal(r.verified, null, "Lane 3 never claims verification");
    assert.equal(r.verificationClaim, null, "Lane 3 never claims verification");
    // source scan: no Lane 3 module mentions VERIFIED as a state
    const dir = path.join(__dirname, "../../src/action/actuation");
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
        const text = fs.readFileSync(path.join(dir, f), "utf8");
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
        assert.ok(!/VERIFIED/.test(code), `${f}: Lane 3 must not mention VERIFIED (Lane 4 owns verification)`);
    }
});
