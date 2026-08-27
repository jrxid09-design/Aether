"use strict";

/**
 * Shared helpers for capability registry tests.
 *
 * Descriptors are now descriptive-only: they carry NO `provenance` field.
 * Provenance identity originates from a registrar (runtime-created). The
 * `descriptor()` helper produces a provenance-free descriptor body; tests
 * register it through a registrar via `register()`.
 */

const { CapabilityRegistry } = require("../../src/capability/registry");

function descriptor(overrides = {}) {
    return {
        schemaVersion: 1,
        id: "filesystem.read",
        kind: "system",
        provider: "core",
        source: "core/runtime",
        operations: ["read"],
        ...overrides
    };
}

/**
 * Build a registry plus a set of registrars keyed by domain. Returns:
 *   { registry, registrar, core, extension, device, provider,
 *     register(d) — register via the default (core) registrar }
 */
function makeRegistry({ clock, ...rest } = {}) {
    const c = clock ?? { nowMs: () => 42 };
    const registry = new CapabilityRegistry({ clock: c, ...rest });

    const core = registry.createRegistrar({ domain: "core" });
    const extension = registry.createRegistrar({ domain: "extension", registrarId: "testext" });
    const device = registry.createRegistrar({ domain: "device", registrarId: "testdevice" });
    const provider = registry.createRegistrar({ domain: "provider", registrarId: "testprovider" });

    return {
        c,
        registry,
        registrar: core,
        core,
        extension,
        device,
        provider,
        register: (d) => core.registerCanonical(d)
    };
}

module.exports = { descriptor, makeRegistry };
