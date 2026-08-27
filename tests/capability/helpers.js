"use strict";

/** Shared helpers for capability registry tests. */

const { CapabilityRegistry } = require("../../src/capability/registry");

function descriptor(overrides = {}) {
    return {
        schemaVersion: 1,
        id: "filesystem.read",
        kind: "system",
        provider: "core",
        source: "core/runtime",
        operations: ["read"],
        provenance: "core/runtime",
        ...overrides
    };
}

function makeRegistry({ clock, ...rest } = {}) {
    const c = clock ?? { nowMs: () => 42 };
    return {
        c,
        registry: new CapabilityRegistry({ clock: c, ...rest })
    };
}

module.exports = { descriptor, makeRegistry };
