"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const AIToolRegistry = require("../../src/ai/tools/AIToolRegistry");
const AIRuntime = require("../../src/ai/runtime/AIRuntime");

test("registry snapshots refresh atomically without exposing handlers", () => {
    const registry = new AIToolRegistry();
    registry.register({ name: "tool-A", description: "A", execute() {} });
    const runtime = new AIRuntime({}, { timeout: 1000 });
    runtime.setToolRegistry(registry);
    assert.equal(typeof runtime.getToolRegistry, "undefined");
    assert.equal(runtime.listTools()[0].name, "tool-A");
    assert.equal(Object.prototype.hasOwnProperty.call(runtime.listTools()[0], "execute"), false);

    const refreshed = new AIToolRegistry();
    refreshed.register({ name: "tool-B", description: "B", execute() {} });
    runtime.setToolRegistry(refreshed);
    assert.deepEqual(runtime.listTools().map(t => t.name), ["tool-B"]);
    assert.equal(runtime.executor.toolRegistry, undefined);
});

test("registry wrappers are not canonical production registry references", () => {
    const registry = new AIToolRegistry();
    const wrapper = { get: registry.get.bind(registry) };
    assert.notEqual(wrapper, registry);
    assert.equal(Object.create(registry) === registry, false);
});
