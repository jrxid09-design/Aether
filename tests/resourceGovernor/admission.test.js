"use strict";

const test = require("node:test");
const {
    assert, manualClock, FakeObserver, ThrowingObserver,
    makeGovernor, BASE_CONFIG, demand
} = require("./helpers");
const { createWorkloadId } = require("../../src/runtime/resourceGovernor/ids");
const { ADMISSION_OUTCOMES: OUT, REASONS, PRESSURE_BANDS } = require("../../src/runtime/resourceGovernor/model");

test("admission: healthy host admits an AGENT workload with authentic lease", () => {
    const gov = makeGovernor({ config: BASE_CONFIG });
    const d = gov.admit(createWorkloadId("agent-1"), demand());
    assert.equal(d.outcome, OUT.ADMIT);
    assert.equal(d.reason, REASONS.OK_ADMITTED);
    assert.equal(d.lease.workloadId, "agent-1");
    assert.equal(d.lease.kind, "ResourceLease");
});

test("admission: global limit enforced — excess queued deterministically", () => {
    const gov = makeGovernor({
        config: { ...BASE_CONFIG, globalConcurrencyLimit: 12, groupLimits: { default: 12 }, maxQueue: 8 }
    });
    for (let i = 1; i <= 12; i++) {
        assert.equal(gov.admit(createWorkloadId(`w-${i}`), demand()).outcome, OUT.ADMIT);
    }
    const thirteenth = gov.admit(createWorkloadId("w-13"), demand());
    assert.equal(thirteenth.outcome, OUT.QUEUE);
    assert.equal(thirteenth.reason, REASONS.OK_QUEUED);
    assert.equal(gov.getResourceStatus().activeLeases, 12);
});

test("admission: group limit enforced independently of global headroom", () => {
    const gov = makeGovernor({
        config: {
            globalConcurrencyLimit: 10,
            groupLimits: { "llm-heavy": 1, default: 10 },
            maxQueue: 8
        }
    });
    const first = gov.admit(createWorkloadId("llm-a"), demand({ concurrencyGroup: "llm-heavy" }));
    assert.equal(first.outcome, OUT.ADMIT);
    const second = gov.admit(createWorkloadId("llm-b"), demand({ concurrencyGroup: "llm-heavy" }));
    assert.equal(second.outcome, OUT.QUEUE);
    assert.equal(second.reason, REASONS.OK_QUEUED);
});

test("admission: class-specific limit enforced", () => {
    const gov = makeGovernor({
        config: { ...BASE_CONFIG, classConcurrencyLimits: { TEST: 1 }, maxQueue: 8 }
    });
    assert.equal(gov.admit(createWorkloadId("t-1"), demand({ workloadClass: "TEST" })).outcome, OUT.ADMIT);
    const second = gov.admit(createWorkloadId("t-2"), demand({ workloadClass: "TEST" }));
    assert.equal(second.outcome, OUT.QUEUE);
    assert.equal(gov.getResourceStatus().queueDepth >= 1, true);
});

test("admission: unknown concurrency group fails closed", () => {
    const gov = makeGovernor({ config: BASE_CONFIG });
    const d = gov.admit(createWorkloadId("escape-1"), demand({ concurrencyGroup: "sneaky-new-group" }));
    assert.equal(d.outcome, OUT.REJECT_RESOURCE_LIMIT);
    assert.equal(d.reason, REASONS.UNKNOWN_GROUP);
});

test("admission: malformed workload id and demand fail closed without state change", () => {
    const gov = makeGovernor({ config: BASE_CONFIG });
    assert.equal(gov.admit("not-an-id-object", demand()).reason, REASONS.INVALID_WORKLOAD_ID);
    const badMem = gov.admit(createWorkloadId("ok-id-1"), { workloadClass: "AGENT", memoryBytesHint: -5 });
    assert.equal(badMem.reason, REASONS.INVALID_DEMAND);
    const badCls = gov.admit(createWorkloadId("ok-id-2"), { workloadClass: "WAT" });
    assert.equal(badCls.reason, REASONS.INVALID_DEMAND);
    const st = gov.getResourceStatus();
    assert.equal(st.metrics.rejected, 3);
    assert.equal(st.activeLeases, 0);
});

test("admission: BACKGROUND queues at ELEVATED pressure while INTERACTIVE still admits", () => {
    const gov = makeGovernor({
        config: { ...BASE_CONFIG, eventLoopLagMs: { elevated: 100, high: 500, critical: 900 } },
        observer: new FakeObserver({ eventLoopLagMs: 150 })
    });
    const bg = gov.admit(createWorkloadId("bg-1"), demand({ workloadClass: "BACKGROUND", priority: 20 }));
    assert.equal(bg.outcome, OUT.QUEUE);
    assert.notEqual(bg.reason, undefined);
    const inter = gov.admit(createWorkloadId("ui-1"), demand({ workloadClass: "INTERACTIVE" }));
    assert.equal(inter.outcome, OUT.ADMIT);
});

test("admission: CRITICAL pressure blocks heavy classes but not INTERACTIVE", () => {
    const gov = makeGovernor({
        config: BASE_CONFIG,
        observer: new FakeObserver({ eventLoopLagMs: 2000 })
    });
    const heavy = gov.admit(createWorkloadId("re-big"),
        demand({ workloadClass: "RE_ANALYSIS", concurrencyGroup: "re-analysis" }));
    assert.notEqual(heavy.outcome, OUT.ADMIT);
    const inter = gov.admit(createWorkloadId("ui-hot"), demand({ workloadClass: "INTERACTIVE" }));
    assert.equal(inter.outcome, OUT.ADMIT);
    assert.notEqual(gov.getResourceStatus().pressureBand, PRESSURE_BANDS.UNKNOWN);
});

test("admission: severe event-loop lag defers heavy even when RAM is plentiful", () => {
    const clock = manualClock();
    const gov = makeGovernor({
        config: { ...BASE_CONFIG, eventLoopLagMs: { elevated: 100, high: 250, critical: 900 } },
        observer: new FakeObserver({ eventLoopLagMs: 500 }),
        clock
    });
    const d = gov.admit(createWorkloadId("cpu-hog"), demand({ workloadClass: "AGENT" }));
    assert.equal(d.outcome, OUT.DEFER);
    assert.equal(d.reason, REASONS.DEFERRED_EVENT_LOOP_SEVERE);
});

test("admission: host memory hard ceiling rejects heavy outright", () => {
    const gov = makeGovernor({
        config: { ...BASE_CONFIG, memoryThresholds: { hostHardFloorBytes: 1e9 } },
        observer: new FakeObserver({ totalMemBytes: 16e9, freeMemBytes: 0.5e9 })
    });
    const d = gov.admit(createWorkloadId("mem-hog"),
        demand({ workloadClass: "RE_ANALYSIS", memoryBytesHint: 1.5e9 }));
    assert.equal(d.outcome, OUT.REJECT_RESOURCE_LIMIT);
    assert.equal(d.reason, REASONS.MEMORY_HARD_CEILING);
});

test("admission: observer failure => UNKNOWN diagnostics, heavy defers, light admits", () => {
    const gov = makeGovernor({ config: BASE_CONFIG, observer: new ThrowingObserver() });
    const st0 = gov.getResourceStatus();
    assert.equal(st0.pressureBand, PRESSURE_BANDS.UNKNOWN);
    assert.equal(st0.observerHealthy, false);
    const heavy = gov.admit(createWorkloadId("ag-x"), demand());
    assert.equal(heavy.reason, REASONS.DEFERRED_OBSERVER_UNAVAILABLE);
    const light = gov.admit(createWorkloadId("tk-x"), demand({ workloadClass: "TOOL" }));
    assert.equal(light.outcome, OUT.ADMIT);
    assert.ok(st0.diagnostics.length >= 1);
});

test("admission: queue overflow produces explicit QUEUE_FULL rejection", () => {
    const gov = makeGovernor({
        config: { ...BASE_CONFIG, maxQueue: 2 },
        observer: new FakeObserver({ eventLoopLagMs: 2000 })
    });
    gov.admit(createWorkloadId("q-1"), demand());
    gov.admit(createWorkloadId("q-2"), demand());
    const overflow = gov.admit(createWorkloadId("q-3"), demand());
    assert.equal(overflow.outcome, OUT.REJECT_RESOURCE_LIMIT);
    assert.equal(overflow.reason, REASONS.QUEUE_FULL);
});
