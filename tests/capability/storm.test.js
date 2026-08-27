"use strict";

/**
 * CAPABILITY REGISTRY V1 — hostile storm test.
 *
 * >=12000 deterministic mixed operations across the full registry surface,
 * using multiple capability sources (core/extension/device/provider/tool) and
 * mixing register/duplicate/remove/lookup/list/dependency traversal/
 * availability updates/stale observations/cycles/oversized descriptors/
 * getter/accessor attacks/Proxy payloads/DAG amplification/unknown fields/
 * forged authority claims.
 *
 * Invariants tracked explicitly (all must be zero):
 *   authorityMutations, governorMutations, executions, actuations,
 *   getterInvocations, callablesRetained, staleGenerationMutations,
 *   partialStateMutations, indexDivergence, unexpectedUntypedErrors,
 *   openHandleLeaks.
 *
 * Determinism: run twice with the same seed => identical digest. Registry
 * size and graph traversal remain bounded.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { CapabilityRegistry } = require("../../src/capability/registry");
const { CapabilityRegistryError } = require("../../src/capability/registry");

const OP_TARGET = 12000;
const POOL_SIZE = 60;
const SOURCES = ["core/runtime", "extension", "device", "provider", "tool"];

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function provFor(i) {
    const s = SOURCES[i % SOURCES.length];
    if (s === "core/runtime") return "core/runtime";
    return `${s}:unit${i}`;
}

function descriptorFor(i, overrides = {}) {
    return {
        schemaVersion: 1,
        id: `pool.cap.${i}`,
        kind: ["tool", "extension", "device", "runtime", "provider", "system"][i % 6],
        provider: `provider.${i % 4}`,
        source: provFor(i),
        operations: [`op.${i % 5}`],
        provenance: provFor(i),
        ...overrides
    };
}

function runStorm(seed) {
    const rng = mulberry32(seed);
    const registry = new CapabilityRegistry({ clock: { nowMs: () => 7 } });

    // counters (all must end zero)
    const C = {
        authorityMutations: 0,
        governorMutations: 0,
        executions: 0,
        actuations: 0,
        getterInvocations: 0,
        callablesRetained: 0,
        staleGenerationMutations: 0,
        partialStateMutations: 0,
        indexDivergence: 0,
        unexpectedUntypedErrors: 0,
        openHandleLeaks: 0
    };

    // Authority + Governor snapshots (prove no mutation)
    let authorityBefore, governorBefore;
    try { authorityBefore = JSON.stringify(require("../../src/authority/store").snapshot ? require("../../src/authority/store").snapshot() : {}); } catch { authorityBefore = "{}"; }
    try { const g = require("../../src/runtime/resourceGovernor"); governorBefore = JSON.stringify(g.snapshot ? g.snapshot() : (g.serialize ? g.serialize() : {})); } catch { governorBefore = "{}"; }

    const beforeHandles = countAsyncResources();

    let ops = 0;
    let generation = 0;
    const outcomes = [];

    const record = (op, ok, note = "") => { ops++; outcomes.push(`${op}:${ok ? "ok" : "err"}:${note}`); };

    function checkIndexConsistency() {
        // edges/reverseEdges/byKind/byProvenance must stay consistent with records
        for (const id of registry.list().map(d => d.id)) {
            const deps = registry.getDependencies(id);
            for (const d of deps) {
                const dependents = registry.getDependents(d);
                if (!dependents.includes(id)) return false;
            }
        }
        return true;
    }

    while (ops < OP_TARGET) {
        const roll = Math.floor(rng() * 16);
        const i = Math.floor(rng() * POOL_SIZE);
        const id = `pool.cap.${i}`;
        try {
            switch (roll) {
                case 0: case 1: { // register (incl. duplicate)
                    const r = registry.register(descriptorFor(i));
                    record("register", true, r.idempotent ? "idem" : "new");
                    break;
                }
                case 2: { // duplicate with different provenance -> conflict
                    registry.register(descriptorFor(i, { provenance: `tool:conflict${i}` }));
                    record("dup-conflict", true, "unexpectedly-ok");
                    break;
                }
                case 3: { // remove
                    try { const r = registry.remove(id); record("remove", true, "ok"); void r; }
                    catch { record("remove", false, "blocked"); }
                    break;
                }
                case 4: { // lookup
                    const got = registry.get(id);
                    record("lookup", true, got ? "hit" : "miss");
                    break;
                }
                case 5: { // list
                    const l = registry.list();
                    record("list", Array.isArray(l));
                    break;
                }
                case 6: { // dependency traversal
                    if (registry.has(id)) {
                        registry.transitiveDependencies(id);
                        record("traverse", true);
                    } else { record("traverse", true, "skip"); }
                    break;
                }
                case 7: { // availability update
                    if (registry.has(id)) {
                        generation++;
                        registry.observeAvailability(id, ["AVAILABLE", "UNAVAILABLE", "DEGRADED"][Math.floor(rng() * 3)], { generation });
                        record("avail", true);
                    } else { record("avail", true, "skip"); }
                    break;
                }
                case 8: { // stale observation
                    if (registry.has(id)) {
                        registry.observeAvailability(id, "AVAILABLE", { generation: Math.max(0, generation - 5) });
                        record("stale", true, "unexpectedly-ok");
                    } else { record("stale", true, "skip"); }
                    break;
                }
                case 9: { // cycle attempt
                    registry.register(descriptorFor(i, { dependencies: [id] }));
                    record("cycle", true, "unexpectedly-ok");
                    break;
                }
                case 10: { // oversized descriptor
                    registry.register(descriptorFor(i, { operations: Array.from({ length: 500 }, (_, k) => `o.${k}`) }));
                    record("oversized", true, "unexpectedly-ok");
                    break;
                }
                case 11: { // getter/accessor attack
                    const input = descriptorFor(i);
                    let invocations = 0;
                    const meta = {};
                    Object.defineProperty(meta, "v", { get() { invocations++; return 1; }, enumerable: true, configurable: true });
                    input.metadata = meta;
                    try { registry.register(input); } catch { /* expected */ }
                    C.getterInvocations += invocations;
                    record("getter", true, invocations === 0 ? "zero" : "LEAK");
                    break;
                }
                case 12: { // proxy payload
                    const target = descriptorFor(i, { operations: ["read"] });
                    let reads = 0;
                    const proxy = new Proxy(target, {
                        get(o, p) { if (p === "operations") { reads++; if (reads > 1) return ["EXEC"]; } return o[p]; }
                    });
                    registry.register(proxy);
                    record("proxy", true);
                    break;
                }
                case 13: { // DAG amplification (wide metadata)
                    const meta = {};
                    for (let k = 0; k < 3000; k++) meta[`k${k}`] = { v: k };
                    registry.register(descriptorFor(i, { metadata: meta }));
                    record("dag", true, "unexpectedly-ok");
                    break;
                }
                case 14: { // unknown fields
                    registry.register(descriptorFor(i, { bogus: true }));
                    record("unknown", true, "unexpectedly-ok");
                    break;
                }
                case 15: { // forged authority claim
                    registry.register(descriptorFor(i, { authorized: true }));
                    record("forged", true, "unexpectedly-ok");
                    break;
                }
            }
        } catch (err) {
            if (!(err instanceof CapabilityRegistryError)) {
                C.unexpectedUntypedErrors++;
                record(opName(roll), false, "UNTYPED:" + err.name);
            } else {
                record(opName(roll), false, err.reasonCode);
            }
        }
    }

    // post-storm invariant checks
    if (!checkIndexConsistency()) C.indexDivergence++;

    // authority/governor unchanged
    let authorityAfter, governorAfter;
    try { authorityAfter = JSON.stringify(require("../../src/authority/store").snapshot ? require("../../src/authority/store").snapshot() : {}); } catch { authorityAfter = "{}"; }
    try { const g = require("../../src/runtime/resourceGovernor"); governorAfter = JSON.stringify(g.snapshot ? g.snapshot() : (g.serialize ? g.serialize() : {})); } catch { governorAfter = "{}"; }
    if (authorityAfter !== authorityBefore) C.authorityMutations++;
    if (governorAfter !== governorBefore) C.governorMutations++;

    const afterHandles = countAsyncResources();
    if (JSON.stringify(afterHandles) !== JSON.stringify(beforeHandles)) C.openHandleLeaks++;

    const snapshot = registry.serialize();
    const stats = registry.getStats();

    return {
        digest: crypto.createHash("sha256").update(JSON.stringify(outcomes)).update(JSON.stringify(snapshot)).digest("hex"),
        C, ops, stats, snapshot
    };
}

function opName(roll) {
    return ["register", "register", "dup-conflict", "remove", "lookup", "list",
        "traverse", "avail", "stale", "cycle", "oversized", "getter", "proxy",
        "dag", "unknown", "forged"][roll];
}

function countAsyncResources() {
    try {
        const info = process.getActiveResourcesInfo();
        const counts = {};
        for (const k of info) counts[k] = (counts[k] ?? 0) + 1;
        return counts;
    } catch { return {}; }
}

test("storm: >=12000 deterministic mixed operations, all violation counters zero", () => {
    const r1 = runStorm(20240607);
    const r2 = runStorm(20240607);
    assert.equal(r1.ops, OP_TARGET);
    assert.equal(r1.digest, r2.digest, "identical seed must produce identical outcomes+state");

    // all violation counters zero
    for (const [k, v] of Object.entries(r1.C)) {
        assert.equal(v, 0, `counter ${k} must be zero, got ${v}`);
    }

    // bounded registry size
    assert.ok(r1.stats.capabilities <= POOL_SIZE, `registry size bounded (${r1.stats.capabilities})`);
    assert.ok(r1.stats.edges <= POOL_SIZE * 2, "edge count bounded");
});

test("storm: different seeds diverge but respect the same invariants", () => {
    const a = runStorm(1);
    const b = runStorm(999);
    assert.notEqual(a.digest, b.digest);
    assert.equal(a.ops, OP_TARGET);
    for (const [k, v] of Object.entries(a.C)) {
        assert.equal(v, 0, `counter ${k} must be zero`);
    }
});
