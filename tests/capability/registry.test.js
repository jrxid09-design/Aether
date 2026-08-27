"use strict";

/**
 * CAPABILITY REGISTRY V1 — focused behavioral tests (part 1: core model,
 * immutability, duplicates, hostile input, cycles).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { CapabilityRegistry } = require("../../src/capability/registry");
const { descriptor, makeRegistry } = require("./helpers");

test("1. register a valid descriptor", () => {
    const { registry } = makeRegistry();
    const res = registry.register(descriptor());
    assert.equal(res.registered, true);
    assert.equal(registry.size, 1);
});

test("2. retrieve a detached immutable descriptor", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "browser.navigate", kind: "tool", provenance: "tool:browser" }));
    const got = registry.get("browser.navigate");
    assert.equal(got.id, "browser.navigate");
    assert.ok(Object.isFrozen(got));
    assert.ok(Object.isFrozen(got.operations));
    assert.throws(() => { got.id = "hacked"; });
    assert.equal(registry.get("browser.navigate").id, "browser.navigate");
});

test("3. caller mutation after register does not mutate registry state", () => {
    const { registry } = makeRegistry();
    const input = descriptor({ operations: ["read"] });
    registry.register(input);
    input.operations.push("write");
    input.id = "changed.id";
    assert.deepEqual(registry.get("filesystem.read").operations, ["read"]);
});

test("4. mutation of returned object does not mutate canonical state", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ metadata: { nested: { x: 1 } } }));
    const got = registry.get("filesystem.read");
    assert.throws(() => { got.metadata.nested.x = 999; });
    assert.equal(registry.get("filesystem.read").metadata.nested.x, 1);
});

test("5. duplicate same descriptor is a deterministic idempotent no-op", () => {
    const { registry } = makeRegistry();
    const r1 = registry.register(descriptor());
    const r2 = registry.register(descriptor());
    assert.equal(r1.registered, true);
    assert.equal(r2.idempotent, true);
    assert.equal(registry.size, 1);
});

test("6. duplicate id with different provenance is a typed conflict", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ provenance: "core/runtime" }));
    assert.throws(
        () => registry.register(descriptor({ provenance: "extension:foo" })),
        (e) => e.reasonCode === "DUPLICATE_CONFLICT");
    assert.equal(registry.size, 1);
});

test("7. duplicate id with materially different descriptor is a typed conflict", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ operations: ["read"] }));
    assert.throws(
        () => registry.register(descriptor({ operations: ["read", "write"] })),
        (e) => e.reasonCode === "DUPLICATE_CONFLICT");
});

test("8. unknown fields are rejected (closed schema)", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ extraField: true })),
        (e) => e.reasonCode === "UNKNOWN_FIELD");
});

test("9. unknown kind fails closed", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ kind: "dragon" })),
        (e) => e.reasonCode === "UNKNOWN_KIND");
});

test("10. invalid id is rejected", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ id: "Bad ID!" })),
        (e) => e.reasonCode === "INVALID_CAPABILITY_ID");
    assert.throws(() => registry.register(descriptor({ id: "../etc/passwd" })),
        (e) => e.reasonCode === "INVALID_CAPABILITY_ID");
});

test("11. oversized id is rejected", () => {
    const { registry } = makeRegistry();
    const long = "x".repeat(300);
    assert.throws(() => registry.register(descriptor({ id: long })),
        (e) => e.reasonCode === "INVALID_CAPABILITY_ID");
});

test("12. operations bound is enforced", () => {
    const { registry } = makeRegistry();
    const ops = Array.from({ length: 100 }, (_, i) => `op.${i}`);
    assert.throws(() => registry.register(descriptor({ operations: ops })),
        (e) => e.reasonCode === "BOUND_EXCEEDED");
});

test("13. dependency count bound is enforced", () => {
    const { registry } = makeRegistry();
    const deps = Array.from({ length: 100 }, (_, i) => `dep.${i}`);
    assert.throws(() => registry.register(descriptor({ dependencies: deps })),
        (e) => e.reasonCode === "BOUND_EXCEEDED");
});

test("14. metadata depth bound is enforced", () => {
    const { registry } = makeRegistry();
    let meta = { leaf: 1 };
    for (let i = 0; i < 20; i++) meta = { nested: meta };
    assert.throws(() => registry.register(descriptor({ metadata: meta })),
        (e) => e.reasonCode === "BOUND_EXCEEDED");
});

test("15. metadata global node budget is enforced (wide DAG)", () => {
    const { registry } = makeRegistry();
    const meta = {};
    for (let i = 0; i < 2000; i++) meta[`k${i}`] = { v: i };
    assert.throws(() => registry.register(descriptor({ metadata: meta })),
        (e) => e.reasonCode === "BOUND_EXCEEDED");
});

test("16. cyclic input object is rejected", () => {
    const { registry } = makeRegistry();
    const meta = {};
    meta.self = meta;
    assert.throws(() => registry.register(descriptor({ metadata: meta })),
        (e) => e.reasonCode === "CYCLIC_INPUT");
});

test("17. accessor descriptor is rejected", () => {
    const { registry } = makeRegistry();
    const input = descriptor();
    Object.defineProperty(input, "id", { get() { return "filesystem.read"; }, enumerable: true, configurable: true });
    assert.throws(() => registry.register(input),
        (e) => e.reasonCode === "ACCESSOR_PROPERTY");
});

test("18. getter invocation count is zero", () => {
    const { registry } = makeRegistry();
    let invocations = 0;
    const input = descriptor();
    const meta = {};
    Object.defineProperty(meta, "value", { get() { invocations++; return 1; }, enumerable: true, configurable: true });
    input.metadata = meta;
    assert.throws(() => registry.register(input));
    assert.equal(invocations, 0, "getters must never be invoked during registration");
});

test("19. Proxy second-read smuggling is contained", () => {
    const { registry } = makeRegistry();
    let reads = 0;
    const target = descriptor({ operations: ["read"] });
    const proxy = new Proxy(target, {
        get(obj, prop) {
            if (prop === "operations") {
                reads++;
                if (reads > 1) return ["INJECTED.EXECUTE"];
                return obj[prop];
            }
            return obj[prop];
        }
    });
    const res = registry.register(proxy);
    assert.equal(res.registered, true);
    assert.deepEqual(registry.get("filesystem.read").operations, ["read"]);
});

test("20. function payload is rejected", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ metadata: { fn: () => {} } })),
        (e) => e.reasonCode === "FUNCTION_VALUE");
});

test("21. symbol key/value is rejected", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ metadata: { [Symbol("k")]: 1 } })),
        (e) => e.reasonCode === "SYMBOL_VALUE");
    assert.throws(() => registry.register(descriptor({ metadata: { k: Symbol("v") } })),
        (e) => e.reasonCode === "SYMBOL_VALUE");
});

test("22. self dependency cycle is rejected", () => {
    const { registry } = makeRegistry();
    assert.throws(() => registry.register(descriptor({ id: "a.one", dependencies: ["a.one"] })),
        (e) => e.reasonCode === "DEPENDENCY_CYCLE");
    assert.equal(registry.size, 0, "no partial state after cycle rejection");
});

test("23. two-node cycle is rejected", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "a.one", dependencies: ["a.two"] }));
    assert.throws(() => registry.register(descriptor({ id: "a.two", dependencies: ["a.one"] })),
        (e) => e.reasonCode === "DEPENDENCY_CYCLE");
    assert.equal(registry.size, 1);
    assert.deepEqual(registry.getDependencies("a.one"), ["a.two"]);
});

test("24. multi-node cycle is rejected", () => {
    const { registry } = makeRegistry();
    registry.register(descriptor({ id: "a.one", dependencies: ["a.two"] }));
    registry.register(descriptor({ id: "a.two", dependencies: ["a.three"] }));
    assert.throws(() => registry.register(descriptor({ id: "a.three", dependencies: ["a.one"] })),
        (e) => e.reasonCode === "DEPENDENCY_CYCLE");
    assert.equal(registry.size, 2);
});
