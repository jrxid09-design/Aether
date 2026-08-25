"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeFakeProvider, makeSystem } = require("./helpers/fakes");
const { CheckpointBuilder, RecoveryCheckpointAborted } = require("../../src/runtime/recovery/checkpoint");
const { resolveRecoveryConfig, DEFAULT_RECOVERY_CONFIG } = require("../../src/runtime/recovery/config");
const { DiagnosticCollector } = require("../../src/runtime/recovery/diagnostics");

test("config: defaults frozen and complete", () => {
    assert.ok(Object.isFrozen(DEFAULT_RECOVERY_CONFIG));
    for (const key of [
        "maxCapsuleBytes", "maxSectionBytes", "maxSections", "maxCandidateCapsules",
        "maxDiagnostics", "maxLineageDepth", "maxProviderCount",
        "maxMetadataKeys", "maxMetadataStringLength"
    ]) {
        assert.ok(Number.isSafeInteger(DEFAULT_RECOVERY_CONFIG[key]) && DEFAULT_RECOVERY_CONFIG[key] > 0);
    }
});

test("config: unknown override keys rejected", () => {
    assert.throws(() => resolveRecoveryConfig({ maxSectionsHack: 1e9 }), /unknown recovery config key/);
});

test("config: non-positive and non-integer bounds rejected", () => {
    assert.throws(() => resolveRecoveryConfig({ maxSections: 0 }), RangeError);
    assert.throws(() => resolveRecoveryConfig({ maxSectionBytes: -5 }), RangeError);
    assert.throws(() => resolveRecoveryConfig({ maxProviderCount: 2.5 }), RangeError);
});

test("bounds: section count enforced at checkpoint time", async () => {
    const s = makeSystem({ maxSections: 1 });
    s.registry.register(makeFakeProvider({ id: "a" }));
    s.registry.register(makeFakeProvider({ id: "b" }));
    await assert.rejects(
        () => new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current }),
        RecoveryCheckpointAborted
    );
    assert.equal(s.store.size, 0);
});

test("bounds: provider count enforced at registration", () => {
    const s = makeSystem({ maxProviderCount: 1 });
    s.registry.register(makeFakeProvider({ id: "a" }));
    assert.throws(() => s.registry.register(makeFakeProvider({ id: "b" })), /provider count exceeds/);
    assert.throws(() => s.registry.register(makeFakeProvider({ id: "a" })), /already registered/);
});

test("bounds: diagnostics collector truncates at bound", () => {
    const c = new DiagnosticCollector(3);
    for (let i = 0; i < 10; i += 1) {
        c.add("UNKNOWN", { message: `d${i}` });
    }
    assert.equal(c.snapshot().length, 3);
});

test("bounds: oversized hostile capsule rejected before excessive allocation where feasible", async () => {
    const s = makeSystem({ maxSectionBytes: 16 });
    s.registry.register(makeFakeProvider({ id: "acc", data: { blob: "z".repeat(4096) } }));
    await assert.rejects(
        () => new CheckpointBuilder(s).run({ reason: "TEST", runtimeGenerationId: s.generationLedger.current }),
        (err) =>
            err instanceof RecoveryCheckpointAborted &&
            /exceeds size bound/.test(String(err.cause?.message ?? ""))
    );
});
