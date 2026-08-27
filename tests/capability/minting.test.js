"use strict";

/**
 * CAPABILITY REGISTRY V1 — registrar minting trust tests.
 *
 * Proves that registrar minting derives from possession of a runtime-owned,
 * unforgeable capability — NOT from strings supplied to a public method.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// Public surface (what arbitrary imported code sees).
const api = require("../../src/capability/registry");

// Internal composition-root boundary (trusted runtime only).
const {
    CapabilityRegistry,
    createCapabilityRegistrarFactory,
    establishIdentity
} = require("../../src/capability/registry/registry");

const { descriptor, makeRegistry } = require("./helpers");

test("mint: CapabilityRegistry instance has no public createRegistrar mint surface", () => {
    const registry = new CapabilityRegistry();
    assert.equal(registry.createRegistrar, undefined, "no createRegistrar method");
    assert.equal(registry.createRegistrarFactory, undefined, "no createRegistrarFactory method");
    assert.equal(registry.createCapabilityRegistrarFactory, undefined);
    // no mint function/token enumerable on the instance
    for (const n of Object.getOwnPropertyNames(registry)) {
        assert.ok(!/mint|registrar|factory|token/i.test(n), `unexpected '${n}'`);
    }
});

test("mint: public index.js exposes no registrar mint surface or factory", () => {
    assert.equal(api.createRegistrar, undefined);
    assert.equal(api.createCapabilityRegistrarFactory, undefined);
    assert.equal(api.establishIdentity, undefined);
    assert.equal(api.MINT_TOKEN, undefined);
    // no registrar factory/identity functions on the public surface
    for (const k of Object.getOwnPropertyNames(api)) {
        assert.ok(!/mint|factory|identity|token/i.test(k), `public surface exposes '${k}'`);
    }
});

test("mint: arbitrary code cannot mint a core registrar via the public surface", () => {
    const registry = new CapabilityRegistry();
    // No public method exists to mint any registrar.
    assert.equal(typeof registry.createRegistrar, "undefined");
    assert.equal(typeof registry.createCoreRegistrar, "undefined");
});

test("mint: arbitrary code cannot mint extension/device/provider registrar from strings", () => {
    const registry = new CapabilityRegistry();
    // caller-supplied domain/registrarId strings have no mint entry point
    assert.equal(registry.createRegistrar, undefined);
    // and the factory (internal) rejects non-established identities
    const factory = createCapabilityRegistrarFactory(registry);
    assert.throws(
        () => factory.createExtensionRegistrar({ domain: "extension", registrarId: "x" }),
        (e) => e.reasonCode === "INVALID_REGISTRAR");
    assert.throws(
        () => factory.createDeviceRegistrar({ domain: "device", registrarId: "x" }),
        (e) => e.reasonCode === "INVALID_REGISTRAR");
    assert.throws(
        () => factory.createProviderRegistrar({ domain: "provider", registrarId: "x" }),
        (e) => e.reasonCode === "INVALID_REGISTRAR");
});

test("mint: forged token / copied / structurally identical identity cannot mint", () => {
    const registry = new CapabilityRegistry();
    const factory = createCapabilityRegistrarFactory(registry);
    // structurally identical object (not established) fails
    assert.throws(() => factory.createCoreRegistrar({ domain: "core" }),
        (e) => e.reasonCode === "INVALID_REGISTRAR");
    // a copied/cloned identity token is a different object identity -> fails
    const real = establishIdentity("extension", "home");
    const clone = { ...real };
    assert.throws(() => factory.createExtensionRegistrar(clone),
        (e) => e.reasonCode === "INVALID_REGISTRAR");
    // Symbol("same-name") cannot substitute for the closure token
    const forgedSym = Symbol("aether.capability.registrar.mint");
    assert.throws(() => factory.createCoreRegistrar(forgedSym),
        (e) => e.reasonCode === "INVALID_REGISTRAR");
});

test("mint: a legitimately issued registrar works", () => {
    const registry = new CapabilityRegistry();
    const factory = createCapabilityRegistrarFactory(registry);
    const core = factory.createCoreRegistrar(establishIdentity("core"));
    const res = core.registerCanonical(descriptor({ id: "legit.one", kind: "system" }));
    assert.equal(res.registered, true);
    assert.equal(registry.get("legit.one").provenance, "core/runtime");
});

test("mint: registrar provenance cannot be changed after issuance", () => {
    const { extension } = makeRegistry();
    assert.equal(extension.provenance, "extension:testext");
    assert.ok(Object.isFrozen(extension));
    assert.throws(() => { extension.provenance = "core/runtime"; });
    assert.throws(() => { extension.domain = "core"; });
    assert.equal(extension.provenance, "extension:testext");
    assert.equal(extension.domain, "extension");
});

test("mint: a normal registrar cannot mint another registrar", () => {
    const { core, extension } = makeRegistry();
    assert.equal(core.createRegistrar, undefined);
    assert.equal(core.createRegistrarFactory, undefined);
    assert.equal(extension.createRegistrar, undefined);
    assert.equal(typeof core.register, "function", "registrar keeps its register boundary");
    assert.equal(typeof core.registerCanonical, "function", "registrar keeps registerCanonical");
    // no mint capability reachable from the registrar object
    for (const n of Object.getOwnPropertyNames(core)) {
        assert.ok(!/mint|factory|token/i.test(n), `registrar exposes '${n}'`);
    }
});

test("mint: attacker cannot admit kind=system under core/runtime via public surface", () => {
    const registry = new CapabilityRegistry();
    // There is no public mint surface, so no registrar can be obtained to
    // admit anything. Confirm no descriptor path sets core provenance.
    assert.equal(registry.size, 0);
    // Even the descriptor parser cannot produce provenance.
    const parsed = api.parseCapabilityDescriptor(descriptor({ id: "x.sys", kind: "system" }));
    assert.equal(parsed.provenance, undefined, "descriptor carries no provenance");
});

test("mint: rejection causes zero canonical mutation / index divergence", () => {
    const registry = new CapabilityRegistry();
    const factory = createCapabilityRegistrarFactory(registry);
    const core = factory.createCoreRegistrar(establishIdentity("core"));
    core.registerCanonical(descriptor({ id: "keep.one", kind: "system" }));
    const digest0 = JSON.stringify(registry.serialize());

    // all forged mint/admission attempts must reject without mutating state
    assert.throws(() => factory.createCoreRegistrar({ domain: "core" }));
    assert.throws(() => factory.createExtensionRegistrar({ domain: "extension", registrarId: "x" }));
    assert.throws(() => factory.createProviderRegistrar({ domain: "provider", registrarId: "x" }));
    assert.throws(() => factory.createCoreRegistrar(Symbol("aether.capability.registrar.mint")));

    const digest1 = JSON.stringify(registry.serialize());
    assert.equal(digest1, digest0);
    assert.equal(registry.size, 1);
    assert.equal(registry.findAllDependencyCycles().length, 0);
});
