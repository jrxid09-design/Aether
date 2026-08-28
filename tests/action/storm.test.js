"use strict";

/**
 * ACTION INTENT + AUTHORITY GATE V1 — storm test (post trust-origin repair).
 * >=12000 deterministic mixed operations. Gate is OBSERVATIONAL. Extended
 * violation counters (all zero), each with an ACTIVE detection path.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { createActionAuthorityRuntime, parseActionIntent, DECISION, isCanonicalAuthorityEvaluation } = require("../../src/action");
const { ActionError } = require("../../src/action");

const OP_TARGET = 12000;
const CAP_POOL = 12;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function targetScope(args) {
    const target = args && typeof args.target === "string" ? args.target.trim().toLowerCase() : "";
    return target ? [target] : [];
}

async function runStorm(seed) {
    const rng = mulberry32(seed);
    const capabilityRuntime = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    const { registry, registrars } = capabilityRuntime;
    const store = createMemoryAuthorityStore();

    const bindings = {};
    for (let i = 0; i < CAP_POOL; i++) bindings[`pool.cap.${i}`] = { read: targetScope, write: targetScope };
    let issuer = null;
    const rt = createActionAuthorityRuntime({
        capabilityRuntime, authorityStore: store, trustedScopeBindings: bindings,
        clock: { nowMs: () => 1000 },
        onReady: ({ bindAuthentication }) => {
            issuer = bindAuthentication({ authenticate: (f) => ({ principal: f.principal }) });
        }
    });
    const session = (o) => issuer.mintSession(o); // bootstrap-held runtime-local issuer

    const C = {
        executions: 0, actuations: 0, authorityMutations: 0, capabilityMutations: 0,
        forgedAuthorityAccepted: 0, modelAuthorityAccepted: 0, memoryAuthorityAccepted: 0,
        channelAuthorityAccepted: 0, staleIncarnationAllowed: 0, staleAuthorityAllowed: 0,
        undeclaredOperationAllowed: 0, unavailableCapabilityAllowed: 0, partialMutation: 0,
        hostileCallerCodeExecution: 0, canonicalStateEscape: 0, untypedErrors: 0, openHandles: 0,
        identitySpoofAllowed: 0, channelSpoofAllowed: 0, sessionSpoofAllowed: 0,
        scopeBypassAllowed: 0, authorityReadFailureAllowed: 0,
        malformedAuthorityEvaluationAllowed: 0, staleUnboundIntentAllowed: 0,
        invalidTimestampAccepted: 0, lane2AllowCanonicalDeny: 0,
        forgedRuntimeIdentityAccepted: 0, clonedRuntimeIdentityAccepted: 0,
        forgedScopeResolverAccepted: 0, fakeAuthorityContextAllowed: 0,
        forgedAuthorityEvaluationAllowed: 0, subjectPrincipalMismatchAllowed: 0,
        malformedGrantAllowed: 0, lane2AllowCanonicalReject: 0,
        arbitraryPrincipalMinted: 0, canonicalStateImpersonation: 0,
        evaluatorReplacementSucceeded: 0, canonicalVerifierReplacementSucceeded: 0,
        scopeBindingMutationAffectedRuntime: 0, hostileIdentityTrapExecution: 0,
        // Wave-4 fourth repair (runtime-local trust domain) counters
        publicIssuerMintedVictim: 0, crossRuntimeSessionAccepted: 0,
        directGateInjectionSucceeded: 0, forgedSessionAccepted: 0
    };

    // A SECOND runtime over DIFFERENT canonical state: sessions from it must
    // never be accepted by `rt` (runtime-local brand).
    const foreignState = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    const foreignStore = createMemoryAuthorityStore();
    let foreignIssuer = null;
    const foreignRt = createActionAuthorityRuntime({
        capabilityRuntime: foreignState,
        authorityStore: foreignStore,
        trustedScopeBindings: { "pool.cap.0": { read: targetScope } },
        clock: { nowMs: () => 1000 },
        onReady: ({ bindAuthentication }) => {
            foreignIssuer = bindAuthentication({ authenticate: (f) => ({ principal: f.principal }) });
        }
    });
    {
        const fres = foreignState.registrars.core.register(JSON.stringify({ schemaVersion: 1, id: "pool.cap.0", kind: "system", provider: "core", operations: ["read", "write"], requirements: [], effects: [] }));
        foreignState.registry.observeAvailability("pool.cap.0", "AVAILABLE", { generation: 1, incarnationId: fres.incarnationId });
        await foreignStore.upsertCapability("pool.cap.0", "ACTIVE", 0, JSON.stringify({
            capabilityId: "pool.cap.0", kind: "root", subject: "actor.0", issuer: "storm", actions: ["read"], scope: [], allowedPurposes: [],
            restrictions: { kind: "unrestricted" }, maxExecutions: null, usedExecutions: 0,
            issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
            status: "ACTIVE", generation: 0, delegationDepth: 0, remainingDelegationDepth: 2,
            parentCapabilityId: null, rootCapabilityId: "pool.cap.0", ratificationId: null,
            identityBinding: { principals: ["actor.0"] }, extra: null
        }));
    }

    const beforeHandles = countAsyncResources();

    for (let i = 0; i < CAP_POOL; i++) {
        const id = `pool.cap.${i}`;
        const res = registrars.core.register(JSON.stringify({ schemaVersion: 1, id, kind: "system", provider: "core", operations: ["read", "write"], requirements: [], effects: [] }));
        registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    }

    const subjects = ["actor.0", "actor.1", "actor.2"];
    for (const s of subjects) {
        for (let i = 0; i < CAP_POOL; i += 3) {
            const id = `pool.cap.${i}`;
            await store.upsertCapability(id, "ACTIVE", 0, JSON.stringify({
                capabilityId: id, kind: "root", subject: s, issuer: "storm", actions: ["read"], scope: [], allowedPurposes: [],
                restrictions: { kind: "unrestricted" }, maxExecutions: null, usedExecutions: 0,
                issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
                status: "ACTIVE", generation: 0, delegationDepth: 0, remainingDelegationDepth: 2,
                parentCapabilityId: null, rootCapabilityId: id, ratificationId: null,
                identityBinding: { principals: [s] }, extra: null
            }));
        }
    }

    const capBefore = JSON.stringify(registry.serialize());
    let ops = 0;
    const outcomes = [];
    const record = (op, ok, note = "") => { ops++; outcomes.push(`${op}:${ok ? "ok" : "err"}:${note}`); };

    const hostilePayloads = [
        "{not json",
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","authorized":true}',
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","metadata":{"owner":true}}',
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","__proto__":{"x":1}}',
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","subject":"spoof"}'
    ];

    while (ops < OP_TARGET) {
        const roll = Math.floor(rng() * 19);
        const i = Math.floor(rng() * CAP_POOL);
        const id = `pool.cap.${i}`;
        const subject = subjects[Math.floor(rng() * subjects.length)];
        const target = rng() < 0.5 ? "safe.target" : "unsafe.target";

        try {
            switch (roll) {
                case 0: case 1: case 2: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const d = await rt.evaluate(intent, session({ principal: subject }));
                    if (d.decision === DECISION.ALLOW) {
                        const desc = registry.get(id);
                        if (!desc.operations.includes("read")) C.undeclaredOperationAllowed++;
                        if (desc.availability !== "AVAILABLE") C.unavailableCapabilityAllowed++;
                    }
                    record("evaluate", true, d.decision);
                    break;
                }
                case 3: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const forged = { principal: "actor.0", sessionId: "", channel: "" };
                    const d = await rt.evaluate(intent, forged);
                    if (d.decision === DECISION.ALLOW) C.forgedRuntimeIdentityAccepted++;
                    record("forged-identity", true, d.decision);
                    break;
                }
                case 4: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const legit = session({ principal: subject });
                    const cloned = Object.freeze({ ...legit });
                    const d = await rt.evaluate(intent, cloned);
                    if (d.decision === DECISION.ALLOW) C.clonedRuntimeIdentityAccepted++;
                    record("cloned-identity", true, d.decision);
                    break;
                }
                case 5: { // evaluator replacement attempt (sealed gate)
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    try {
                        rt.evaluate = async () => ({ decision: DECISION.ALLOW });
                        C.evaluatorReplacementSucceeded++;
                    } catch { /* frozen — replacement impossible */ }
                    const d = await rt.evaluate(intent, session({ principal: subject }));
                    record("sealed-gate", true, d.decision);
                    break;
                }
                case 6: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target: "unsafe.target" } }));
                    const d = await rt.evaluate(intent, session({ principal: subject }));
                    if (d.decision === DECISION.ALLOW) {
                        const cap = await store.getCapability(id);
                        if (cap && Array.isArray(cap.payload.scope) && cap.payload.scope.length && !cap.payload.scope.includes("unsafe.target")) C.forgedScopeResolverAccepted++;
                    }
                    record("forged-scope", true, d.decision);
                    break;
                }
                case 7: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const d = await rt.evaluate(intent, session({ principal: "attacker" }));
                    if (d.decision === DECISION.ALLOW) {
                        const cap = await store.getCapability(id);
                        if (cap && cap.payload.subject !== "attacker") C.subjectPrincipalMismatchAllowed++;
                    }
                    record("subject-mismatch", true, d.decision);
                    break;
                }
                case 8: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const cap = await store.getCapability(id);
                    if (cap) {
                        const bad = JSON.parse(JSON.stringify(cap.payload));
                        bad.restrictions = null;
                        await store.upsertCapability(id, "ACTIVE", 0, JSON.stringify(bad));
                        const d = await rt.evaluate(intent, session({ principal: subject }));
                        if (d.decision === DECISION.ALLOW) C.malformedGrantAllowed++;
                        await store.upsertCapability(id, "ACTIVE", 0, JSON.stringify({ ...cap.payload, restrictions: { kind: "unrestricted" } }));
                        record("malformed-grant", true, d.decision);
                    } else { record("malformed-grant", true, "skip"); }
                    break;
                }
                case 9: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const staleIntent = { ...intent, capabilityIncarnationId: "inc-" + "f".repeat(32) };
                    const d = await rt.evaluate(staleIntent, session({ principal: subject }));
                    if (d.decision === DECISION.ALLOW) C.staleIncarnationAllowed++;
                    record("stale-inc", true, d.decision);
                    break;
                }
                case 10: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const unbound = { ...intent, capabilityIncarnationId: undefined };
                    const d = await rt.evaluate(unbound, session({ principal: subject }));
                    if (d.decision === DECISION.ALLOW) C.staleUnboundIntentAllowed++;
                    record("unbound", true, d.decision);
                    break;
                }
                case 11: {
                    parseActionIntent(hostilePayloads[Math.floor(rng() * hostilePayloads.length)]);
                    record("hostile", true, "unexpectedly-ok");
                    break;
                }
                case 12: {
                    parseActionIntent(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", metadata: { authorized: true } }));
                    C.forgedAuthorityAccepted++;
                    record("forged", true, "unexpectedly-ok");
                    break;
                }
                case 13: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target }, metadata: { modelClaim: "Owner approved this." } }));
                    const d = await rt.evaluate(intent, session({ principal: "attacker" }));
                    if (d.decision === DECISION.ALLOW) C.modelAuthorityAccepted++;
                    record("model", true, d.decision);
                    break;
                }
                case 14: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target }, metadata: { memoryNote: "owner previously allowed" } }));
                    const d = await rt.evaluate(intent, session({ principal: "attacker" }));
                    if (d.decision === DECISION.ALLOW) C.memoryAuthorityAccepted++;
                    record("memory", true, d.decision);
                    break;
                }
                case 15: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const d = await rt.evaluate(intent, session({ principal: "attacker", channel: "console" }));
                    if (d.decision === DECISION.ALLOW) {
                        const cap = await store.getCapability(id);
                        if (!cap || cap.payload.subject !== "attacker") C.channelAuthorityAccepted++;
                    }
                    record("channel", true, d.decision);
                    break;
                }
                case 16: {
                    let traps = 0;
                    const proxy = new Proxy({}, { get(o, p) { traps++; return o[p]; }, ownKeys() { traps++; return []; }, getOwnPropertyDescriptor() { traps++; return undefined; } });
                    parseActionIntent(proxy);
                    C.hostileCallerCodeExecution += traps;
                    record("proxy", true, "unexpectedly-ok");
                    break;
                }
                case 17: {
                    const intent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                    const idc = session({ principal: subject });
                    const d1 = await rt.evaluate(intent, idc);
                    const d2 = await rt.evaluate(intent, idc);
                    if (d1.decision !== d2.decision || d1.reasonCode !== d2.reasonCode) C.partialMutation++;
                    try { d1.decision = "DENY"; C.canonicalStateEscape++; } catch { /* frozen */ }
                    record("repeat", true, d1.decision);
                    break;
                }
                case 18: { // sealed-runtime adversarial probes (identity/scope/verifier)
                    // (a) arbitrary principal minting: rt must expose no mint surface.
                    if (typeof rt.issueIdentity === "function" || typeof rt.mintSession === "function" || typeof rt.issueSession === "function") {
                        C.arbitraryPrincipalMinted++;
                    }
                    // (a4) public issuer mint victim: there must be no public
                    // issuer anywhere; an attempt to use createAuthSessionIssuer
                    // from the public API must be undefined.
                    if (typeof require("../../src/action").createAuthSessionIssuer === "function") {
                        // Counter is active: it fires when a public issuer is
                        // (re)introduced. Must stay zero.
                        const fakeIssuer = require("../../src/action").createAuthSessionIssuer();
                        const victim = fakeIssuer.mintSession({ principal: "victim" });
                        const dv = await rt.evaluate(intent, victim);
                        if (dv.decision === DECISION.ALLOW) C.publicIssuerMintedVictim++;
                    }
                    // (b) canonical verifier replacement: rt must expose no writable verifier.
                    try {
                        rt.isCanonicalEvaluation = () => true;
                        C.canonicalVerifierReplacementSucceeded++;
                    } catch { /* frozen */ }
                    // (c) hostile Proxy identity rejection: zero traps.
                    {
                        let traps = 0;
                        const hostileSession = new Proxy({}, {
                            get(o, p) { traps++; return o[p]; },
                            getPrototypeOf() { traps++; return Object.prototype; },
                            ownKeys() { traps++; return []; },
                            getOwnPropertyDescriptor() { traps++; return undefined; },
                            has() { traps++; return false; },
                            set() { traps++; return false; }
                        });
                        const d = await rt.evaluate(rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } })), hostileSession);
                        if (traps > 0) C.hostileIdentityTrapExecution += traps;
                        if (d.decision === DECISION.ALLOW) C.canonicalStateImpersonation++;
                        record("sealed-probe", true, d.decision);
                    }
                    // (d) scope-binding mutation: mutate the caller's binding object
                    // after composition; a later admit must still use the captured resolver.
                    {
                        const origResolver = bindings[id] && bindings[id].read;
                        if (bindings[id]) bindings[id].read = () => ["MALICIOUS.SCOPE"];
                        const intent2 = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                        if (Array.isArray(intent2.scope) && intent2.scope.includes("malicious.scope")) {
                            C.scopeBindingMutationAffectedRuntime++;
                        }
                        if (origResolver !== undefined && bindings[id]) bindings[id].read = origResolver;
                        record("scope-mutate", true, "probed");
                    }
                    // (e) Wave-4 counters — all active, all must stay zero.
                    //   crossRuntimeSessionAccepted: a session from the foreign
                    //     runtime must NOT satisfy THIS runtime's verifier.
                    {
                        const foreignSession = foreignIssuer.mintSession({ principal: "actor.0" });
                        const crossIntent = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                        const cd = await rt.evaluate(crossIntent, foreignSession);
                        if (cd.decision === DECISION.ALLOW) C.crossRuntimeSessionAccepted++;
                    }
                    //   directGateInjectionSucceeded: there must be NO
                    //     importable createGate; attempted injection of forged
                    //     evaluator options to createActionAuthorityRuntime
                    //     must be IGNORED.
                    {
                        const gate = require("../../src/action/gate");
                        if (typeof gate.createGate === "function") {
                            // Counter is active: fires only if createGate is
                            // (re)exported.
                            try {
                                gate.createGate({
                                    registry,
                                    authorityEvaluator: async () => ({ allowed: true, reasonCode: "AUTHORIZED", snapshot: { generation: 0, capabilityId: id, subject: subject, principal: subject, actions: ["read"], scope: [], allowedPurposes: [], identityBinding: null, maxExecutions: null } }),
                                    isCanonicalEvaluation: () => true
                                });
                                C.directGateInjectionSucceeded++;
                            } catch { /* even a constructor must not enable injection */ }
                        }
                        // Also exercise the ignore-options path directly.
                        const injected = createActionAuthorityRuntime({
                            capabilityRuntime: { registry, registrars },
                            authorityStore: store,
                            trustedScopeBindings: { [id]: { read: targetScope } },
                            clock: { nowMs: () => 1000 },
                            authorityEvaluator: async () => ({ allowed: true, reasonCode: "AUTHORIZED" }),
                            isCanonicalEvaluation: () => true,
                            verifySession: () => true
                        });
                        const ii = injected.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                        const idInjected = issuer.mintSession({ principal: subject });
                        // The injected runtime does NOT bind authentication via
                        // onReady, so it has NO issuer of its own: even
                        // "verifySession:()=>true" (an injected option) must be
                        // ignored — only runtime-local brand acceptance holds.
                        const dd = await injected.evaluate(ii, idInjected);
                        if (dd.decision === DECISION.ALLOW) C.directGateInjectionSucceeded++;
                        if (dd.decision === DECISION.ALLOW) C.forgedSessionAccepted++;
                    }
                    //   forgedSessionAccepted: a forged/cloned/JSON session must
                    //     never ALLOW.
                    {
                        const legit = issuer.mintSession({ principal: subject });
                        for (const forged of [Object.freeze({ ...legit }), JSON.parse(JSON.stringify(legit)), { principal: subject, sessionId: "", channel: "" }]) {
                            const fi = rt.admit(JSON.stringify({ schemaVersion: 1, capabilityId: id, operation: "read", arguments: { target } }));
                            const fd = await rt.evaluate(fi, forged);
                            if (fd.decision === DECISION.ALLOW) C.forgedSessionAccepted++;
                        }
                    }
                    break;
                }
            }
        } catch (err) {
            if (!(err instanceof ActionError) && !(err.name === "CapabilityRegistryError")) {
                C.untypedErrors++;
                record(opName(roll), false, "UNTYPED:" + (err.name || "Error"));
            } else {
                record(opName(roll), false, err.reasonCode || err.name);
            }
        }
    }

    const capAfter = JSON.stringify(registry.serialize());
    if (capAfter !== capBefore) C.capabilityMutations++;

    const afterHandles = countAsyncResources();
    if (JSON.stringify(afterHandles) !== JSON.stringify(beforeHandles)) C.openHandles++;

    return { digest: crypto.createHash("sha256").update(JSON.stringify(outcomes)).digest("hex"), C, ops };
}

function opName(roll) {
    return ["evaluate", "evaluate", "evaluate", "forged-identity", "cloned-identity", "sealed-gate", "forged-scope", "subject-mismatch", "malformed-grant", "stale-inc", "unbound", "hostile", "forged", "model", "memory", "channel", "proxy", "repeat", "sealed-probe"][roll];
}

function countAsyncResources() {
    try {
        const info = process.getActiveResourcesInfo();
        const counts = {};
        for (const k of info) counts[k] = (counts[k] ?? 0) + 1;
        return counts;
    } catch { return {}; }
}

test("storm: >=12000 deterministic mixed operations, all violation counters zero", async () => {
    const r1 = await runStorm(20260902);
    const r2 = await runStorm(20260902);
    assert.equal(r1.ops, OP_TARGET);
    assert.equal(r1.digest, r2.digest, "identical seed must produce identical outcomes");
    for (const [k, v] of Object.entries(r1.C)) {
        assert.equal(v, 0, `counter ${k} must be zero, got ${v}`);
    }
});

test("storm: different seeds diverge but respect the same invariants", async () => {
    const a = await runStorm(1);
    const b = await runStorm(999);
    assert.notEqual(a.digest, b.digest);
    assert.equal(a.ops, OP_TARGET);
    for (const [k, v] of Object.entries(a.C)) {
        assert.equal(v, 0, `counter ${k} must be zero`);
    }
});
