"use strict";

const test = require("node:test");
const { assert, governorFactory } = require("./helpers");
const { computePressureBand } = governorFactory.pressure;

function cfg() {
    return governorFactory.config.validateResourceGovernorConfig({});
}

function snap(over = {}) {
    return {
        observerHealthy: true,
        totalMemBytes: 1000,
        freeMemBytes: 500,
        heapUsedBytes: 1,
        heapLimitBytes: 4,
        eventLoopLagMs: 5,
        ...over
    };
}

test("pressure: all signals normal => NORMAL", () => {
    const r = computePressureBand({ snapshot: snap(), config: cfg() });
    assert.equal(r.band, "NORMAL");
});

test("pressure: host used-memory ratio drives band (worst-of wins)", () => {
    const c = cfg();
    assert.equal(computePressureBand({ snapshot: snap({ freeMemBytes: 350 }), config: c }).band, "ELEVATED");
    assert.equal(computePressureBand({ snapshot: snap({ freeMemBytes: 200 }), config: c }).band, "HIGH");
    assert.equal(computePressureBand({ snapshot: snap({ freeMemBytes: 80 }), config: c }).band, "CRITICAL");
});

test("pressure: process heap ratio contributes independently of host", () => {
    const r = computePressureBand({ snapshot: snap({ heapUsedBytes: 3.4, heapLimitBytes: 4 }), config: cfg() });
    assert.equal(r.band, "HIGH");
});

test("pressure: event-loop lag alone can reach CRITICAL even with perfect RAM", () => {
    const r = computePressureBand({ snapshot: snap({ eventLoopLagMs: 900, totalMemBytes: 1e9, freeMemBytes: 9e8 }), config: cfg() });
    assert.equal(r.band, "CRITICAL");
    assert.equal(r.contributions.lagBand, "CRITICAL");
});

test("pressure: hard floor forces CRITICAL", () => {
    const c = governorFactory.config.validateResourceGovernorConfig({
        memoryThresholds: { hostHardFloorBytes: 300 }
    });
    const r = computePressureBand({ snapshot: snap({ freeMemBytes: 250 }), config: c });
    assert.equal(r.band, "CRITICAL");
    assert.equal(r.contributions.hardFloorHit, true);
});

test("pressure: unhealthy observation yields UNKNOWN, never NORMAL", () => {
    const r = computePressureBand({ snapshot: { observerHealthy: false }, config: cfg() });
    assert.equal(r.band, "UNKNOWN");
});
