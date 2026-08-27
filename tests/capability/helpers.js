"use strict";

/**
 * Shared helpers for capability registry tests.
 *
 * Descriptors are descriptive-only (no `provenance` field). Provenance identity
 * originates from a registrar minted through the runtime-owned composition
 * boundary (createCapabilityRegistrarFactory + establishIdentity), which lives
 * in `./registry` and is NOT part of the public `index.js` surface.
 */

const { CapabilityRegistry } = require("../../src/capability/registry");
const {
    createCapabilityRegistrarFactory,
    establishIdentity
} = require("../../src/capability/registry/registry");

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
 * Build a registry plus a set of registrars keyed by domain, minted through the
 * trusted composition root. Returns:
 *   { registry, registrar (core), core, extension, device, provider,
 *     register(d) — register via the core registrar }
 */
function makeRegistry({ clock, ...rest } = {}) {
    const c = clock ?? { nowMs: () => 42 };
    const registry = new CapabilityRegistry({ clock: c, ...rest });

    const factory = createCapabilityRegistrarFactory(registry);

    const core = factory.createCoreRegistrar(establishIdentity("core"));
    const extension = factory.createExtensionRegistrar(establishIdentity("extension", "testext"));
    const device = factory.createDeviceRegistrar(establishIdentity("device", "testdevice"));
    const provider = factory.createProviderRegistrar(establishIdentity("provider", "testprovider"));

    return {
        c,
        registry,
        factory,
        registrar: core,
        core,
        extension,
        device,
        provider,
        register: (d) => core.registerCanonical(d)
    };
}

module.exports = { descriptor, makeRegistry };
