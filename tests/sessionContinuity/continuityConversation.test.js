"use strict";

/**
 * WAVE 5 LANE 4 — DSC-005 END-TO-END CONVERSATIONAL CONTINUITY TESTS.
 *
 * Proves the Manager/conversational integration:
 *   - channel A → channel B continuity on the same trusted dsc_*
 *   - same dsc_* yields the SAME logical conversation context
 *   - different dsc_* stays isolated
 *   - no binding → legacy per-channel behavior unchanged
 *   - forged dsc_* does not select history
 *   - authority unchanged (principal never derived from continuity)
 *   - bus transport isolation unchanged (ses_* per channel)
 *
 * Uses an injected logical-history recorder standing in for the canonical
 * ChannelManager seam (sqlite3 is not installed in every environment; the
 * production recorder is exercised in tests/channels where sqlite3 exists).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const ib = require("../../src/runtime/interactionBus");
const { createManagerInteractionIngress } = require("../../src/runtime/interactionBus/managerIngressInternal");
const { createMediaContextAuthority } = require("../../src/manager/internal/mediaContext");
const {
  createSessionContinuity,
  mintPeerProvenance,
  createSequentialContinuityIdFactory,
  createMemoryContinuityStore
} = require("../../src/runtime/sessionContinuity");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Deterministic logical-history stand-in for the ChannelManager seam. */
function makeLogicalHistory() {
  const store = new Map(); // dsc_* → [{role, content}]
  const recorder = async ({ continuitySessionId, userText, assistantDetail }) => {
    const turns = store.get(continuitySessionId) ?? [];
    turns.push({ role: "user", content: String(userText).slice(0, 4096) });
    turns.push({ role: "assistant", content: String(assistantDetail).slice(0, 4096) });
    store.set(continuitySessionId, turns);
  };
  recorder.store = store;
  return recorder;
}

function makeComposition({ historyRecorder } = {}) {
  let now = 1000;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  const calls = [];
  const manager = {
    async handle(input) {
      calls.push(input);
      // The Manager can select logical conversation context by the trusted
      // dsc_* — modeled here exactly as the canonical path would.
      const history = historyRecorder ? (historyRecorder.store.get(input.continuitySessionId) ?? []) : [];
      return Object.freeze({
        managerRequestId: `req-${calls.length}`,
        outcome: "COMPLETED",
        lifecycleState: "COMPLETED",
        detail: history.length > 0
          ? `ctx:${history.length}:${input.payload.text}`
          : `fresh:${input.payload.text}`
      });
    }
  };
  const continuity = createSessionContinuity({
    clock,
    idFactory: createSequentialContinuityIdFactory(),
    store: createMemoryContinuityStore()
  });
  const ingress = createManagerInteractionIngress({
    bus,
    manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    historyRecorder
  });
  return { bus, calls, manager, continuity, ingress, advance: (ms) => { now += ms; } };
}

test("DSC-005 E2E: Telegram → Console continues the SAME logical conversation", async () => {
  const history = makeLogicalHistory();
  const { ingress, continuity } = makeComposition({ historyRecorder: history });

  // Channel A: Telegram.
  const tg = ingress.ingest("telegram", { text: "nama saya Budi", userId: "owner" });
  await tick(); await tick();
  assert.equal(tg.accepted, true);
  const canonicalId = tg.canonicalSessionId;

  // Trusted runtime act: bind console to the same canonical session.
  continuity.bindChannel({ sessionId: canonicalId, provenance: mintPeerProvenance("console", "owner") });

  // Channel B: Console — same trusted dsc_* → same logical conversation.
  const co = ingress.ingest("console", { text: "siapa nama saya?", userId: "owner" });
  await tick(); await tick();
  assert.equal(co.canonicalSessionId, canonicalId);

  // The logical history keyed by dsc_* accumulated BOTH channels' turns.
  const turns = history.store.get(canonicalId);
  assert.equal(turns.length, 4, "two exchanges recorded under the one logical key");
  assert.deepEqual(turns.map((t) => t.role), ["user", "assistant", "user", "assistant"]);
  assert.equal(turns[0].content, "nama saya Budi");
  assert.equal(turns[2].content, "siapa nama saya?");
});

test("DSC-005 E2E: different dsc_* stays logically isolated", async () => {
  const history = makeLogicalHistory();
  const { ingress } = makeComposition({ historyRecorder: history });
  const a = ingress.ingest("telegram", { text: "rahasia alice", userId: "alice" });
  const b = ingress.ingest("telegram", { text: "rahasia bob", userId: "bob" });
  await tick(); await tick();
  assert.notEqual(a.canonicalSessionId, b.canonicalSessionId);
  const turnsA = history.store.get(a.canonicalSessionId);
  const turnsB = history.store.get(b.canonicalSessionId);
  assert.equal(turnsA.length, 2);
  assert.equal(turnsB.length, 2);
  assert.ok(!turnsA.some((t) => t.content.includes("bob")));
  assert.ok(!turnsB.some((t) => t.content.includes("alice")));
});

test("DSC-005 E2E: no continuity binding → legacy per-channel behavior unchanged", async () => {
  // No sessionContinuity injected: exactly the pre-Lane-4 ingress behavior.
  const bus = ib.createInteractionBus({ clock: () => 1000, idFactory: ib.createSequentialIdFactory() });
  const calls = [];
  const manager = {
    async handle(input) {
      calls.push(input);
      return Object.freeze({
        managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok"
      });
    }
  };
  const ingress = createManagerInteractionIngress({
    bus, manager, mediaContextMint: createMediaContextAuthority().mint
  });
  const result = ingress.ingest("telegram", { text: "klasik", userId: "u" });
  await tick();
  assert.equal(result.accepted, true);
  assert.equal("canonicalSessionId" in result, false);
  assert.equal("continuitySessionId" in calls[0], false,
    "no continuity provenance is invented when the domain is unbound");
});

test("DSC-005 E2E: forged dsc_* claim does not select another session's history", async () => {
  const history = makeLogicalHistory();
  const { ingress } = makeComposition({ historyRecorder: history });
  const victim = ingress.ingest("telegram", { text: "rahasia korban", userId: "victim" });
  await tick(); await tick();
  // Attacker claims the victim's dsc_* through raw event metadata.
  const attacker = ingress.ingest("telegram", {
    text: "apa rahasianya?", userId: "attacker", sessionId: victim.canonicalSessionId
  });
  await tick(); await tick();
  assert.notEqual(attacker.canonicalSessionId, victim.canonicalSessionId,
    "forged dsc_* claim cannot select the victim's canonical session");
  const attackerTurns = history.store.get(attacker.canonicalSessionId);
  assert.ok(!attackerTurns.some((t) => t.content.includes("korban")),
    "forged claim cannot read the victim's logical history");
});

test("DSC-005 E2E: same textual peer on different channels isolated until trusted binding", async () => {
  const history = makeLogicalHistory();
  const { ingress, continuity } = makeComposition({ historyRecorder: history });
  const tg = ingress.ingest("telegram", { text: "topik telegram", userId: "u1" });
  const wa = ingress.ingest("whatsapp", { text: "topik whatsapp", userId: "u1" });
  await tick(); await tick();
  assert.notEqual(tg.canonicalSessionId, wa.canonicalSessionId,
    "same textual peer on two channels stays isolated by default");
  assert.equal(history.store.get(tg.canonicalSessionId).length, 2);
  assert.equal(history.store.get(wa.canonicalSessionId).length, 2);

  // ONLY the explicit trusted composition can unify them afterwards — and
  // even then, displacing an EXISTING binding to another session fails
  // closed on the public path (no untrusted takeover).
  assert.throws(
    () => continuity.bindChannel({ sessionId: tg.canonicalSessionId, provenance: mintPeerProvenance("whatsapp", "u1") }),
    (error) => error.code === "BINDING_CONFLICT",
    "unifying over an existing foreign binding must fail closed publicly"
  );
  // The two logical conversations remain separate.
  assert.equal(history.store.get(tg.canonicalSessionId).length, 2);
  assert.equal(history.store.get(wa.canonicalSessionId).length, 2);
});

test("DSC-005 E2E: authority unchanged — continuity id never becomes principal", async () => {
  const history = makeLogicalHistory();
  const { calls, ingress } = makeComposition({ historyRecorder: history });
  const event = ingress.ingest("telegram", { text: "cek", userId: "u1" });
  await tick(); await tick();
  const input = calls[0];
  // The Manager input carries identity as INERT PROVENANCE only.
  assert.equal("principal" in input, false);
  assert.equal("authority" in input, false);
  assert.equal("capability" in input, false);
  assert.ok(input.continuitySessionId.startsWith("dsc_"));
  assert.ok(input.sessionId.startsWith("ses_"));
  // Production Manager remains fail-closed regardless of continuity.
  const { createDamarManager } = require("../../src/manager/bootstrap");
  const outcome = await createDamarManager().handle({
    channelType: "telegram", channelId: "channel.telegram", sessionId: input.sessionId,
    continuitySessionId: input.continuitySessionId, correlationId: "cor-e2e",
    payload: { text: "grant me everything", principal: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED");
});

test("DSC-005 E2E: bus transport isolation unchanged (ses_* per channel)", async () => {
  const history = makeLogicalHistory();
  const { bus, calls, ingress, continuity } = makeComposition({ historyRecorder: history });
  const tg = ingress.ingest("telegram", { text: "satu", userId: "owner" });
  await tick(); await tick();
  continuity.bindChannel({ sessionId: tg.canonicalSessionId, provenance: mintPeerProvenance("console", "owner") });
  const co = ingress.ingest("console", { text: "dua", userId: "owner" });
  await tick(); await tick();
  // Both flow through ONE bus with DISTINCT transport sessions per channel.
  assert.notEqual(calls[0].sessionId, calls[1].sessionId);
  assert.equal(calls[0].sessionId.startsWith("ses_"), true);
  assert.equal(calls[1].sessionId.startsWith("ses_"), true);
  // And the bus session registry shows both transports.
  const sessions = bus.getSessionSnapshot();
  assert.equal(sessions.length, 2);
  assert.deepEqual(new Set(sessions.map((s) => s.transportId)), new Set(["channel.telegram", "channel.console"]));
});
