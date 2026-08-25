"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeFakeProvider, makeSystem } = require("./helpers/fakes");
const { CheckpointBuilder } = require("../../src/runtime/recovery/checkpoint");
const selector = require("../../src/runtime/recovery/selector");
const { executeRestore, RESTORE_OUTCOMES } = require("../../src/runtime/recovery/restore");

async function buildWith(system) {
    const cap = await new CheckpointBuilder(system).run({
        reason: "TEST",
        runtimeGenerationId: system.generationLedger.current
    });
    const decision = selector.decide({
        candidates: [cap],
        registry: system.registry,
        config: system.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.notEqual(decision.outcome, "REFUSE", JSON.stringify(decision.reasonCodes));
    return { cap, decision };
}

function setupThreeProviders() {
    const s = makeSystem();
    const p1 = makeFakeProvider({ id: "alpha", data: { n: 1 } });
    const p2 = makeFakeProvider({ id: "beta", data: { n: 2 } });
    const p3 = makeFakeProvider({ id: "gamma", data: { n: 3 } });
    for (const p of [p1, p2, p3]) {
        s.registry.register(p);
    }
    return { s, p1, p2, p3 };
}

test("restore: happy path commits every section, sorted deterministically", async () => {
    const { s, p1, p2, p3 } = setupThreeProviders();
    const { cap, decision } = await buildWith(s);
    const rec = await executeRestore(decision, cap, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.RESTORED);
    assert.deepEqual([...rec.committedSections], ["alpha", "beta", "gamma"]);
    // canonical order of prepare/commit follows sorted section ids
    assert.deepEqual(
        p1.__state.prepared.map((h) => h.seq),
        [1]
    );
});

test("restore two-phase: all prepares happen before any commit", async () => {
    const s = makeSystem();
    s.registry.register(makeFakeProvider({ id: "a", data: { n: 1 } }));
    s.registry.register(makeFakeProvider({ id: "b", data: { n: 2 } }));

    const events = [];
    const wrap = (id) => {
        const base = s.registry.get(id);
        return Object.assign({}, base, {
            prepareRestore: async (d) => {
                events.push(`prepare:${id}`);
                return d;
            },
            commitRestore: async () => {
                events.push(`commit:${id}`);
            },
            rollbackRestore: async () => {}
        });
    };
    s.registry.providers.set("a", wrap("a"));
    s.registry.providers.set("b", Object.freeze(wrap("b")));

    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const decision = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    await executeRestore(decision, cap, s.registry);
    assert.ok(events.includes("prepare:b"));
    assert.ok(events.indexOf("prepare:a") < events.indexOf("commit:a"));
    assert.ok(events.indexOf("prepare:b") < events.indexOf("commit:a"), "all prepares must precede first commit");
    assert.deepEqual(
        events.filter((e) => e.startsWith("prepare")),
        ["prepare:a", "prepare:b"]
    );
});

test("restore: prepare failure at provider N aborts earlier prepared state; nothing committed", async () => {
    const { s, p1, p2, p3 } = setupThreeProviders();
    p2.__state.prepareFailOn.add("any");
    const { cap, decision } = await buildWith(s);
    const rec = await executeRestore(decision, cap, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.FAILED_PREPARE);
    assert.equal(rec.failedSectionId, "beta");
    assert.deepEqual(rec.committedSections, []);
    // alpha was prepared then aborted; gamma never prepared
    assert.deepEqual([...p3.__state.prepared], []);
    const anyCommitted =
        p1.__state.committed.length + p2.__state.committed.length + p3.__state.committed.length;
    assert.equal(anyCommitted, 0);
    assert.ok(rec.diagnostics.some((d) => d.code === "PREPARE_FAILED" && d.sectionId === "beta"));
});

test("restore: commit failure at provider N rolls back N-1..0 in reverse", async () => {
    const { s, p1, p2, p3 } = setupThreeProviders();
    p2.__state.commitFailOn.add(1); // beta fails on its own first commit
    const { cap, decision } = await buildWith(s);
    const rec = await executeRestore(decision, cap, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.FAILED_COMMIT);
    assert.equal(rec.failedSectionId, "beta");
    // net effect zero: whatever committed was compensated
    assert.deepEqual([...rec.committedSections], []);
    assert.deepEqual([...rec.rolledBackSections].sort(), ["alpha"]);
    assert.deepEqual(p3.__state.committed, [], "provider after failure point never committed");
    assert.deepEqual(p2.__state.rolledBack, [], "failed provider itself not rolled back");
});

test("restore: rollback compensation failure is recorded as ROLLBACK_FAILED", async () => {
    const { s, p1, p2 } = setupThreeProviders();
    p1.__state.noRollback = true;
    p2.__state.commitFailOn.add(1);
    const { cap, decision } = await buildWith(s);
    const rec = await executeRestore(decision, cap, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.FAILED_COMMIT);
    assert.ok(rec.diagnostics.some((d) => d.code === "ROLLBACK_FAILED" && d.sectionId === "alpha"));
});

test("restore: NON_RESUMABLE sections are journaled but never enter prepare/commit", async () => {
    const s = makeSystem();
    s.registry.register(makeFakeProvider({ id: "acc" }));
    s.registry.register(
        makeFakeProvider({
            id: "actuation",
            classification: "NON_RESUMABLE",
            required: false,
            data: { pendingShellCommand: "rm -rf /" }
        })
    );
    const { cap, decision } = await buildWith(s);
    assert.ok(cap.sections.actuation, "NON_RESUMABLE evidence IS checkpointed");
    const rec = await executeRestore(decision, cap, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.RESTORED);
    assert.deepEqual(rec.deferredSections, [{ sectionId: "actuation", status: "INTERRUPTED" }]);
});

test("restore: refused decision never touches providers", async () => {
    const { s, p1 } = setupThreeProviders();
    const refuseDecision = {
        outcome: "REFUSE",
        capsuleId: "rc-" + "0".repeat(32),
        deferredSections: [],
        diagnostics: []
    };
    const rec = await executeRestore(refuseDecision, { manifest: refuseDecision }, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.FAILED_PREPARE);
    assert.equal(p1.__state.prepared.length, 0);
});

test("restore: decision/capsule mismatch fails closed before any provider call", async () => {
    const { s, p1 } = setupThreeProviders();
    const { cap, decision } = await buildWith(s);
    const mismatched = JSON.parse(JSON.stringify(cap));
    mismatched.manifest.capsuleId = "rc-" + "e".repeat(32);
    const rec = await executeRestore(decision, mismatched, s.registry);
    assert.equal(rec.outcome, RESTORE_OUTCOMES.FAILED_PREPARE);
    assert.equal(p1.__state.prepared.length, 0, "no provider may be touched on identity mismatch");
});

test("restore record exposes world-vs-belief contract fields", async () => {
    const { s } = setupThreeProviders();
    const { cap, decision } = await buildWith(s);
    const rec = await executeRestore(decision, cap, s.registry);
    assert.match(rec.note, /NOT freshly verified reality/i);
});
