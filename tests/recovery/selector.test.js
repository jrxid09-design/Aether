"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeFakeProvider, makeSystem } = require("./helpers/fakes");
const { CheckpointBuilder } = require("../../src/runtime/recovery/checkpoint");
const selector = require("../../src/runtime/recovery/selector");
const ids = require("../../src/runtime/recovery/ids");

function setup() {
    const s = makeSystem();
    s.registry.register(makeFakeProvider({ id: "acc", data: { seq: 1 } }));
    return s;
}

test("selector: explicit capsule selection yields RESTORE", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const d = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.RESTORE);
    assert.equal(d.capsuleId, cap.manifest.capsuleId);
});

test("selector: implicit newest-wins refused by default (no silent trust of latest file)", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const d = selector.decide({ candidates: [cap], registry: s.registry, config: s.config });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.REFUSE);
    assert.deepEqual(d.reasonCodes, ["SELECTION_AMBIGUOUS"]);
});

test("selector: explicit id not present refuses with exact reason", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const d = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: ids.newRecoveryCapsuleId()
    });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.REFUSE);
    assert.deepEqual(d.reasonCodes, ["EXPLICIT_SELECTION_NOT_FOUND"]);
});

test("selector: NEWEST_VALID policy picks newest valid candidate deterministically", async () => {
    const s = setup();
    const older = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const newer = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    assert.ok(older.manifest.epochId < newer.manifest.epochId);
    const dShuffled = selector.decide({
        candidates: [newer, older],
        registry: s.registry,
        config: s.config,
        policy: "NEWEST_VALID"
    });
    const dOtherOrder = selector.decide({
        candidates: [older, newer],
        registry: s.registry,
        config: s.config,
        policy: "NEWEST_VALID"
    });
    assert.equal(dShuffled.capsuleId, newer.manifest.capsuleId);
    assert.equal(JSON.stringify(dShuffled), JSON.stringify(dOtherOrder));
});

test("selector: missing OPTIONAL section -> DEGRADED_RESTORE naming exactly what degraded", async () => {
    const s = makeSystem();
    s.registry.register(makeFakeProvider({ id: "acc", data: {} }));
    s.registry.register(
        makeFakeProvider({
            id: "sensorium",
            classification: "PUBLIC_STATE",
            required: false,
            capture: () => null
        })
    );
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    assert.ok(!cap.manifest.sections.some((x) => x.sectionId === "sensorium"));
    const d = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.DEGRADED_RESTORE);
    assert.deepEqual([...d.degradedSections], ["sensorium"]);
    assert.ok(d.reasonCodes.includes("DEGRADED_MISSING_OPTIONAL_SECTIONS"));
});

test("selector: missing REQUIRED section -> REFUSE with explicit reason", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    s.registry.register(makeFakeProvider({ id: "governor", required: true }));
    const d = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.REFUSE);
    assert.deepEqual(d.reasonCodes, ["MISSING_REQUIRED_SECTION"]);
});

test("selector: unsupported schema version -> REFUSE UNSUPPORTED_VERSION", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    // subsystem upgraded to v2 after checkpoint; new registry expects v2
    const upgraded = makeSystem();
    upgraded.registry.register(makeFakeProvider({ id: "acc", schemaVersion: 2, data: { seq: 1 } }));
    const d = selector.decide({
        candidates: [cap],
        registry: upgraded.registry,
        config: upgraded.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.REFUSE);
    assert.deepEqual(d.reasonCodes, ["UNSUPPORTED_VERSION"]);
});

test("selector: incomplete/invalid candidate refused fail-closed under NEWEST_VALID too", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const broken = JSON.parse(JSON.stringify({ manifest: cap.manifest, sections: cap.sections }));
    broken.manifest.status = "BUILDING";
    const d = selector.decide({
        candidates: [broken],
        registry: s.registry,
        config: s.config,
        policy: "NEWEST_VALID"
    });
    assert.equal(d.outcome, selector.DECISION_OUTCOMES.REFUSE);
    assert.deepEqual(d.reasonCodes, ["INCOMPLETE_CAPSULE"]);
});

test("selector: AUTHORITY_SENSITIVE section -> opaque; decision demands revalidation, never interprets", async () => {
    const s = makeSystem();
    s.registry.register(makeFakeProvider({ id: "authority", classification: "AUTHORITY_SENSITIVE", required: false, data: { grants: [] } }));
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const d = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.ok(d.requiresAuthorityRevalidation);
    assert.ok(d.reasonCodes.includes("AUTHORITY_REVALIDATION_REQUIRED"));
    assert.ok(d.deferredSections.some((x) => x.sectionId === "authority" && x.status === "REQUIRES_REVALIDATION"));
});

test("selector: NON_RESUMABLE section deferred as INTERRUPTED, never auto-resumed", async () => {
    const s = makeSystem();
    s.registry.register(makeFakeProvider({ id: "actuation", classification: "NON_RESUMABLE", required: false, data: { cmd: "half-typed" } }));
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const d = selector.decide({
        candidates: [cap],
        registry: s.registry,
        config: s.config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.deepEqual(d.deferredSections, [{ sectionId: "actuation", status: "INTERRUPTED" }]);
    assert.ok(d.reasonCodes.includes("NON_RESUMABLE_STATE_DEFERRED"));
});

test("selector: candidate list bounded by config", async () => {
    const s = setup();
    const cap = await new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current });
    const many = Array.from({ length: 50 }, () => cap);
    const d = selector.decide({
        candidates: many,
        registry: s.registry,
        config: makeSystem({ maxCandidateCapsules: 4 }).config,
        requestedCapsuleId: cap.manifest.capsuleId
    });
    assert.notEqual(d.outcome, undefined);
});
