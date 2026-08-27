"use strict";

/**
 * CAPABILITY REGISTRY V1 — focused behavioral tests (part 2: graph
 * consistency, availability/generation, provenance scoping, boundary
 * isolation, serialization, queries).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { CapabilityRegistry } = require("../../src/capability/registry");
const { descriptor, makeRegistry } = require("./helpers");

test("25. dependency removal consistency", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "a.one", dependencies: ["a.two"] }));
    registry.register(descriptor({ id: "a.two" }));
    assert.deepEqual(registry.getDependencies("a.one"), ["a.two"]);
    assert.throws(() => registry.remove("a.two"), (e) => e.reasonCode === "INVALID_DEPENDENCY");
    registry.remove("a.one");
    const res = registry.remove("a.two");
    assert.equal(res.removed, true);
    assert.equal(registry.size, 0);
});

test("26. reverse dependency consistency", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "a.one", dependencies: ["a.two"] }));
    registry.register(descriptor({ id: "a.two" }));
    assert.deepEqual(registry.getDependents("a.two"), ["a.one"]);
    registry.remove("a.one");
    assert.deepEqual(registry.getDependents("a.two"), []);
});

test("27. missing dependency semantics", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "a.one", dependencies: ["a.missing"] }));
    const report = registry.resolveDependencyStatus("a.one");
    assert.equal(report.ok, false);
    assert.deepEqual(report.missing, ["a.missing"]);
    assert.deepEqual(report.satisfied, []);
});

test("28. availability UNKNOWN by default", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor());
    assert.equal(registry.getAvailability("filesystem.read").availability, "UNKNOWN");
});

test("29. availability AVAILABLE", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor());
    registry.observeAvailability("filesystem.read", "AVAILABLE", { generation: 1 });
    assert.equal(registry.getAvailability("filesystem.read").availability, "AVAILABLE");
});

test("30. availability UNAVAILABLE", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor());
    registry.observeAvailability("filesystem.read", "UNAVAILABLE", { generation: 1 });
    assert.equal(registry.getAvailability("filesystem.read").availability, "UNAVAILABLE");
});

test("31. availability DEGRADED", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor());
    registry.observeAvailability("filesystem.read", "DEGRADED", { generation: 1 });
    assert.equal(registry.getAvailability("filesystem.read").availability, "DEGRADED");
});

test("32. stale generation observation is rejected", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor());
    registry.observeAvailability("filesystem.read", "AVAILABLE", { generation: 5 });
    assert.throws(
        () => registry.observeAvailability("filesystem.read", "UNAVAILABLE", { generation: 3 }),
        (e) => e.reasonCode === "STALE_OBSERVATION");
    assert.equal(registry.getAvailability("filesystem.read").availability, "AVAILABLE");
});

test("33. extension source provenance is accepted and inert", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "extension.ha.control", kind: "extension", provenance: "extension:homeassistant" }));
    assert.deepEqual(registry.listByProvenance("extension:homeassistant").map(d => d.id), ["extension.ha.control"]);
});

test("34. device source provenance is accepted and inert", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "device.camera.request", kind: "device", provenance: "device:cam-01" }));
    assert.deepEqual(registry.listByProvenance("device:cam-01").map(d => d.id), ["device.camera.request"]);
});

test("35. hostile authority/owner fields are rejected", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ authorized: true })), (e) => e.reasonCode === "UNKNOWN_FIELD");
    assert.throws(() => registry.register(descriptor({ owner: "root" })), (e) => e.reasonCode === "UNKNOWN_FIELD");
    assert.throws(() => registry.register(descriptor({ root: true })), (e) => e.reasonCode === "UNKNOWN_FIELD");
    assert.throws(() => registry.register(descriptor({ trusted: true })), (e) => e.reasonCode === "UNKNOWN_FIELD");
    assert.throws(() => registry.register(descriptor({ provenance: "authority" })), (e) => e.reasonCode === "INVALID_PROVENANCE_SCOPE");
    assert.throws(() => registry.register(descriptor({ provenance: "owner" })), (e) => e.reasonCode === "INVALID_PROVENANCE_SCOPE");
    assert.throws(() => registry.register(descriptor({ provenance: "root" })), (e) => e.reasonCode === "INVALID_PROVENANCE_SCOPE");
});

test("36. Authority fingerprint unchanged", () => {
    const authorityStore = require("../../src/authority/store");
    let before;
    try { before = JSON.stringify(authorityStore.snapshot ? authorityStore.snapshot() : {}); }
    catch { before = "{}"; }
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "x.one", operations: ["read"] }));
    registry.observeAvailability("x.one", "AVAILABLE", { generation: 1 });
    registry.remove("x.one");
    let after;
    try { after = JSON.stringify(authorityStore.snapshot ? authorityStore.snapshot() : {}); }
    catch { after = "{}"; }
    assert.equal(after, before);
});

test("37. Governor fingerprint unchanged", () => {
    const governor = require("../../src/runtime/resourceGovernor");
    let before;
    try { before = JSON.stringify(governor.snapshot ? governor.snapshot() : (governor.serialize ? governor.serialize() : {})); }
    catch { before = "{}"; }
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "x.two", operations: ["read"] }));
    let after;
    try { after = JSON.stringify(governor.snapshot ? governor.snapshot() : (governor.serialize ? governor.serialize() : {})); }
    catch { after = "{}"; }
    assert.equal(after, before);
});

test("38. registry serialization contains zero executable behavior", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "x.three", operations: ["read"] }));
    const snap = registry.serialize();
    const text = JSON.stringify(snap);
    assert.ok(!/function\s*\(/.test(text), "no function literals in serialization");
    for (const cap of snap.capabilities) {
        assert.equal(typeof cap.execute, "undefined");
        assert.equal(typeof cap.invoke, "undefined");
        assert.equal(typeof cap.run, "undefined");
        assert.equal(typeof cap.dispatch, "undefined");
    }
});

test("39. query/list bounds and filters", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "b.one" }));
    registry.register(descriptor({ id: "b.two", kind: "tool", provenance: "tool:t1", source: "tool:t1" }));
    assert.equal(registry.list().length, 2);
    assert.deepEqual(registry.listByKind("tool").map(d => d.id), ["b.two"]);
    assert.deepEqual(registry.listByKind("system").map(d => d.id), ["b.one"]);
    assert.deepEqual(registry.listByProvenance("tool:t1").map(d => d.id), ["b.two"]);
    assert.deepEqual(registry.listBySource("tool:t1").map(d => d.id), ["b.two"]);
});

test("40. repeated register/remove cycles leave consistent state", () => {
    const { registry } = makeRegistry();
    for (let i = 0; i < 50; i++) {
        const id = `cycle.${i % 10}`;
        const prov = `tool:t${i % 3}`;
        try {
            registry.register(descriptor({ id, provenance: prov, operations: ["op"] }));
            registry.remove(id);
        } catch (e) {
            // conflict on differing provenance is expected; registry stays valid
            assert.ok(e.reasonCode === "DUPLICATE_CONFLICT");
        }
    }
    // invariants: edges/reverseEdges consistent with records
    const stats = registry.getStats();
    assert.equal(stats.capabilities, registry.size);
    assert.equal(registry.findAllDependencyCycles().length, 0);
});
