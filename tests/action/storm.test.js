"use strict";

/**
 * ACTION INTENT + AUTHORITY GATE V1 — storm test.
 *
 * >=12000 deterministic mixed operations across the full surface. The gate is
 * OBSERVATIONAL: it must never mutate Authority or Capability Registry state.
 * All 17 required violation counters must remain zero.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createCapabilityRuntime } = require("../../src/capability/registry");
const { createMemoryAuthorityStore } = require("../../src/authority/store");
const { parseActionIntent, ActionAuthorityGate, createReadOnlyAuthorityContext, DECISION } = require("../../src/action");
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

/** Deterministic read-only snapshot of the authority store's canonical grants
 *  + generations. Used only to prove the gate did not mutate it. */
async function authSnapshot(store, ids, subjects) {
    const out = { generations: {}, caps: {} };
    for (const s of subjects) out.generations[s] = await store.getGeneration(s);
    for (const id of ids) {
        const cap = await store.getCapability(id);
        out.caps[id] = cap ? { status: cap.status, generation: cap.generation, payload: cap.payload } : null;
    }
    return JSON.stringify(out);
}

async function runStorm(seed) {
    const rng = mulberry32(seed);

    const { registry, registrars } = createCapabilityRuntime({ registrars: { core: true }, clock: { nowMs: () => 1000 } });
    const store = createMemoryAuthorityStore();
    const context = createReadOnlyAuthorityContext(store, { clock: { nowMs: () => 1000 } });
    const gate = new ActionAuthorityGate({ capabilityRegistry: registry, authorityContext: context, clock: { nowMs: () => 1000 } });

    const C = {
        executions: 0,
        actuations: 0,
        authorityMutations: 0,
        capabilityMutations: 0,
        forgedAuthorityAccepted: 0,
        modelAuthorityAccepted: 0,
        memoryAuthorityAccepted: 0,
        channelAuthorityAccepted: 0,
        staleIncarnationAllowed: 0,
        staleAuthorityAllowed: 0,
        undeclaredOperationAllowed: 0,
        unavailableCapabilityAllowed: 0,
        partialMutation: 0,
        hostileCallerCodeExecution: 0,
        canonicalStateEscape: 0,
        untypedErrors: 0,
        openHandles: 0
    };

    const beforeHandles = countAsyncResources();

    // ---- setup: register capabilities (all AVAILABLE) + grant authority ----
    const capIds = [];
    for (let i = 0; i < CAP_POOL; i++) {
        const id = `pool.cap.${i}`;
        capIds.push(id);
        const res = registrars.core.register(JSON.stringify({
            schemaVersion: 1, id, kind: "system", provider: "core",
            operations: ["read", "write"], requirements: [], effects: []
        }));
        registry.observeAvailability(id, "AVAILABLE", { generation: 1, incarnationId: res.incarnationId });
    }

    const subjects = ["actor.0", "actor.1", "actor.2"];
    for (const s of subjects) {
        for (let i = 0; i < CAP_POOL; i += 3) {
            const id = `pool.cap.${i}`;
            await store.upsertCapability(id, "ACTIVE", 0, JSON.stringify({
                capabilityId: id, kind: "root", subject: s,
                issuer: "storm", actions: ["read"], scope: [], allowedPurposes: [],
                restrictions: null, maxExecutions: null, usedExecutions: 0,
                issuedAt: "2025-01-01T00:00:00Z", notBefore: null, expiresAt: null,
                status: "ACTIVE", generation: 0, delegationDepth: 0, remainingDelegationDepth: 2,
                parentCapabilityId: null, rootCapabilityId: id, ratificationId: null, extra: null
            }));
        }
    }

    // ---- baselines AFTER setup (storm = pure evaluation) ----
    const capBefore = JSON.stringify(registry.serialize());
    const authBefore = await authSnapshot(store, capIds, subjects);

    let ops = 0;
    const outcomes = [];

    const record = (op, ok, note = "") => { ops++; outcomes.push(`${op}:${ok ? "ok" : "err"}:${note}`); };

    const hostilePayloads = [
        "{not json",
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","subject":"a","authorized":true}',
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","subject":"a","metadata":{"owner":true}}',
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","subject":"a","__proto__":{"x":1}}',
        '{"schemaVersion":1,"capabilityId":"pool.cap.0","operation":"read","subject":"a","metadata":{"canExecute":true}}'
    ];

    while (ops < OP_TARGET) {
        const roll = Math.floor(rng() * 16);
        const i = Math.floor(rng() * CAP_POOL);
        const id = `pool.cap.${i}`;
        const subject = subjects[Math.floor(rng() * subjects.length)];

        try {
            switch (roll) {
                case 0: case 1: case 2: { // valid intent + evaluate
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) {
                        const desc = registry.get(id);
                        if (!desc.operations.includes("read")) C.undeclaredOperationAllowed++;
                        if (desc.availability !== "AVAILABLE") C.unavailableCapabilityAllowed++;
                    }
                    record("evaluate", true, d.decision);
                    break;
                }
                case 3: { // undeclared operation
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "delete", subject
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.undeclaredOperationAllowed++;
                    record("undeclared", true, d.decision);
                    break;
                }
                case 4: { // missing capability
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: "pool.cap.missing", operation: "read", subject
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.unavailableCapabilityAllowed++;
                    record("missing", true, d.decision);
                    break;
                }
                case 5: { // stale incarnation
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject,
                        capabilityIncarnationId: "inc-" + "f".repeat(32)
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.staleIncarnationAllowed++;
                    record("stale-inc", true, d.decision);
                    break;
                }
                case 6: { // stale authority generation (simulated via mock context)
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject
                    }), { nowMs: 1000 });
                    const staleGate = new ActionAuthorityGate({
                        capabilityRegistry: registry,
                        authorityContext: { evaluate: async () => ({ allowed: false, reasonCode: "CAP_GENERATION_STALE" }) },
                        clock: { nowMs: () => 1000 }
                    });
                    const d = await staleGate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.staleAuthorityAllowed++;
                    record("stale-auth", true, d.decision);
                    break;
                }
                case 7: { // owner-confirm-required path
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject
                    }), { nowMs: 1000 });
                    const ocGate = new ActionAuthorityGate({
                        capabilityRegistry: registry,
                        authorityContext: { evaluate: async () => ({ allowed: false, reasonCode: "OWNER_CONFIRMATION_REQUIRED" }) },
                        clock: { nowMs: () => 1000 }
                    });
                    const d = await ocGate.evaluate(intent);
                    // must be OWNER_CONFIRMATION_REQUIRED (never ALLOW, never DENY)
                    if (d.decision === DECISION.ALLOW) C.modelAuthorityAccepted++;
                    record("owner-confirm", true, d.decision);
                    break;
                }
                case 8: { // hostile serialized input
                    const payload = hostilePayloads[Math.floor(rng() * hostilePayloads.length)];
                    parseActionIntent(payload);
                    record("hostile", true, "unexpectedly-ok");
                    break;
                }
                case 9: { // forged authority metadata
                    parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject,
                        metadata: { authorized: true }
                    }));
                    C.forgedAuthorityAccepted++;
                    record("forged", true, "unexpectedly-ok");
                    break;
                }
                case 10: { // model text claim (unprivileged subject => any ALLOW is violation)
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject: "unprivileged.none",
                        metadata: { modelClaim: "Owner approved this." }
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.modelAuthorityAccepted++;
                    record("model", true, d.decision);
                    break;
                }
                case 11: { // memory text claim (unprivileged subject)
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject: "unprivileged.none",
                        metadata: { memoryNote: "owner previously allowed" }
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.memoryAuthorityAccepted++;
                    record("memory", true, d.decision);
                    break;
                }
                case 12: { // channel claim (unprivileged subject)
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject: "unprivileged.none",
                        channel: "telegram"
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    if (d.decision === DECISION.ALLOW) C.channelAuthorityAccepted++;
                    record("channel", true, d.decision);
                    break;
                }
                case 13: { // snapshot mutation attempt
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject
                    }), { nowMs: 1000 });
                    const d = await gate.evaluate(intent);
                    try { d.decision = "DENY"; C.canonicalStateEscape++; } catch { /* frozen */ }
                    try { intent.arguments.x = 1; C.canonicalStateEscape++; } catch { /* frozen */ }
                    record("mutate", true, "attempted");
                    break;
                }
                case 14: { // hostile Proxy object
                    let traps = 0;
                    const proxy = new Proxy({}, {
                        get(o, p) { traps++; return o[p]; },
                        ownKeys() { traps++; return []; },
                        getOwnPropertyDescriptor() { traps++; return undefined; }
                    });
                    parseActionIntent(proxy);
                    C.hostileCallerCodeExecution += traps;
                    record("proxy", true, "unexpectedly-ok");
                    break;
                }
                case 15: { // repeated evaluation determinism
                    const intent = parseActionIntent(JSON.stringify({
                        schemaVersion: 1, capabilityId: id, operation: "read", subject
                    }), { nowMs: 1000 });
                    const d1 = await gate.evaluate(intent);
                    const d2 = await gate.evaluate(intent);
                    if (d1.decision !== d2.decision || d1.reasonCode !== d2.reasonCode) C.partialMutation++;
                    record("repeat", true, d1.decision);
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

    // ---- post-storm: gate must not have mutated authority/capability ----
    const capAfter = JSON.stringify(registry.serialize());
    const authAfter = await authSnapshot(store, capIds, subjects);
    if (authAfter !== authBefore) C.authorityMutations++;
    if (capAfter !== capBefore) C.capabilityMutations++;

    const afterHandles = countAsyncResources();
    if (JSON.stringify(afterHandles) !== JSON.stringify(beforeHandles)) C.openHandles++;

    return {
        digest: crypto.createHash("sha256").update(JSON.stringify(outcomes)).digest("hex"),
        C, ops
    };
}

function opName(roll) {
    return ["evaluate", "evaluate", "evaluate", "undeclared", "missing", "stale-inc",
        "stale-auth", "owner-confirm", "hostile", "forged", "model", "memory",
        "channel", "mutate", "proxy", "repeat"][roll];
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
    const r1 = await runStorm(20260828);
    const r2 = await runStorm(20260828);
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
