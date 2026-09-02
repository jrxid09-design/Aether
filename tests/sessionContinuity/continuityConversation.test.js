"use strict";

/**
 * WAVE 5 LANE 4 — DSC-R1-004 REAL CONTINUITY HISTORY INTEGRATION.
 *
 * Uses the REAL production Manager ingress composition
 * (createDamarManagerIngressDomain → createManagerInteractionIngress → real
 * Manager) with the REAL ChannelManager logic.  Because the sqlite3 native
 * module is unavailable in this environment, the SessionStore is injected
 * through the EXISTING supported ChannelManager store seam (constructor
 * injection) — the ChannelManager logic under test is production code, not a
 * fake Manager-owned Map.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const ib = require("../../src/runtime/interactionBus");
const { createDamarManager } = require("../../src/manager/bootstrap");
const { createMediaContextAuthority } = require("../../src/manager/internal/mediaContext");
const {
  createSessionContinuity,
  createSequentialContinuityIdFactory,
  createMemoryContinuityStore
} = require("../../src/runtime/sessionContinuity");
const { ChannelManager } = require("../../src/channels/channelManager");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** In-memory SessionStore stand-in injected through the EXISTING
 * ChannelManager constructor seam (same contract as SessionStore). */
function makeInjectedStore() {
  const rows = new Map();
  return {
    async open() {},
    async load(key) {
      const row = rows.get(key);
      if (!row) return [];
      try { return JSON.parse(row.payload); } catch { return []; }
    },
    async append(key, turn, meta = {}) {
      const turns = await this.load(key);
      turns.push({ role: turn.role, content: turn.content });
      while (turns.length > 20) turns.shift();
      rows.set(key, {
        channel: meta.channel ?? "unknown",
        kind: meta.kind ?? "dm",
        peer: String(meta.peer ?? ""),
        updated_at: Date.now(),
        turns: turns.length,
        payload: JSON.stringify(turns)
      });
      return turns;
    },
    async clear(key) { rows.delete(key); },
    async list() { return [...rows.values()]; },
    _rows: rows
  };
}

/** The REAL production ingress composition wired to a REAL ChannelManager
 * with the injected store.  The peer-evidence provider mirrors the trusted
 * composition: only runtime-owned `trustedPeerEvidence` is consulted. */
function makeRealComposition() {
  let now = 1000;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  const store = makeInjectedStore();
  const channelManager = new ChannelManager(store);
  let controller = null;
  const continuity = createSessionContinuity({
    clock,
    idFactory: createSequentialContinuityIdFactory(),
    store: createMemoryContinuityStore(),
    trustedLifecycle(c) { controller = c; }
  });
  // The REAL production Manager (fail-closed auth path).
  const manager = createDamarManager();
  const calls = [];
  const managerSpy = {
    handle: async (input) => {
      calls.push(input);
      // The real Manager records continuityContext as inert provenance; the
      // informational path completes without the action fabric.
      return manager.handle(input);
    }
  };
  const ingress = require("../../src/runtime/interactionBus/managerIngressInternal").createManagerInteractionIngress({
    bus,
    manager: managerSpy,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity: { mintPeerProvenance: controller.mintPeerProvenance },
    peerEvidenceProvider: (channel, rawEvent) => {
      const d = Object.getOwnPropertyDescriptor(rawEvent, "trustedPeerEvidence");
      return d && typeof d.value === "string" ? d.value : "";
    },
    historyProvider: (dscId) => channelManager.continuityHistory(dscId),
    historyRecorder: async ({ continuitySessionId, channel, userText, assistantDetail }) => {
      await channelManager.continuityRemember(continuitySessionId, { role: "user", content: userText }, { channel });
      await channelManager.continuityRemember(continuitySessionId, { role: "assistant", content: assistantDetail }, { channel });
    }
  });
  return { ingress, continuity, controller, channelManager, calls, store, advance: (ms) => { now += ms; } };
}

test("DSC-R1-004 REAL: Telegram → Console continues the same logical conversation", async () => {
  const ctx = makeRealComposition();

  // Telegram trusted peer → interaction 1 + 2.
  const t1 = ctx.ingress.ingest("telegram", { text: "nama saya Budi", trustedPeerEvidence: "tg-owner" });
  await tick(); await tick(); await tick();
  const t2 = ctx.ingress.ingest("telegram", { text: "saya suka kopi", trustedPeerEvidence: "tg-owner" });
  await tick(); await tick(); await tick();
  const canonicalId = t1.canonicalSessionId;
  assert.equal(t2.canonicalSessionId, canonicalId);

  // Explicit trusted cross-channel bind: Console joins the same dsc_*.
  ctx.controller.trustedTransferBinding({
    provenance: ctx.controller.mintPeerProvenance("console", "console-owner"),
    toSessionId: canonicalId
  });

  // Console trusted peer → interaction 3 RECEIVES prior logical context.
  const c3 = ctx.ingress.ingest("console", { text: "siapa nama saya?", trustedPeerEvidence: "console-owner" });
  await tick(); await tick(); await tick();
  assert.equal(c3.canonicalSessionId, canonicalId);
  const third = ctx.calls[2];
  assert.ok(Array.isArray(third.continuityContext), "interaction 3 receives logical conversation context");
  assert.equal(third.continuityContext.length, 4, "two prior exchanges (4 turns) from the dsc:* key");
  assert.equal(third.continuityContext[0].content, "nama saya Budi");
  assert.equal(third.continuityContext[2].content, "saya suka kopi");

  // The write path recorded all three exchanges under the ONE logical key.
  const history = await ctx.channelManager.continuityHistory(canonicalId);
  assert.equal(history.length, 6, "3 exchanges × 2 turns through the real ChannelManager");
  assert.equal(history[4].content, "siapa nama saya?");
});

test("DSC-R1-004 REAL: different dsc_* does not see the history", async () => {
  const ctx = makeRealComposition();
  const a = ctx.ingress.ingest("telegram", { text: "rahasia alice", trustedPeerEvidence: "alice" });
  await tick(); await tick(); await tick();
  const b = ctx.ingress.ingest("telegram", { text: "halo", trustedPeerEvidence: "bob" });
  await tick(); await tick(); await tick();
  assert.notEqual(a.canonicalSessionId, b.canonicalSessionId);
  const bobCall = ctx.calls[1];
  assert.equal("continuityContext" in bobCall, false, "bob receives no context from alice's logical conversation");
  const aliceHistory = await ctx.channelManager.continuityHistory(a.canonicalSessionId);
  assert.ok(!aliceHistory.some((t) => t.content.includes("halo")));
});

test("DSC-R1-004 REAL: no continuity binding preserves legacy behavior", async () => {
  const ctx = makeRealComposition();
  // Raw userId only → no continuity, no history read/write, exact legacy path.
  const legacy = ctx.ingress.ingest("telegram", { text: "legacy", userId: "raw-user" });
  await tick(); await tick(); await tick();
  assert.equal("canonicalSessionId" in legacy, false);
  const call = ctx.calls[0];
  assert.equal("continuitySessionId" in call, false);
  assert.equal("continuityContext" in call, false);
  assert.equal(ctx.store._rows.size, 0, "no dsc:* rows written");
});

test("DSC-R1-004 REAL: forged dsc_* cannot select history", async () => {
  const ctx = makeRealComposition();
  const victim = ctx.ingress.ingest("telegram", { text: "rahasia korban", trustedPeerEvidence: "victim" });
  await tick(); await tick(); await tick();
  const attacker = ctx.ingress.ingest("telegram", {
    text: "apa rahasianya?", userId: "victim", sessionId: victim.canonicalSessionId
  });
  await tick(); await tick(); await tick();
  assert.equal("canonicalSessionId" in attacker, false);
  assert.equal("continuityContext" in ctx.calls[1], false);
  assert.deepEqual([...ctx.store._rows.keys()], [`dsc:${victim.canonicalSessionId}`]);
});

test("DSC-R1-004 REAL: ses_* transport isolation and authority unchanged", async () => {
  const ctx = makeRealComposition();
  const t1 = ctx.ingress.ingest("telegram", { text: "satu", trustedPeerEvidence: "owner" });
  await tick(); await tick(); await tick();
  ctx.controller.trustedTransferBinding({
    provenance: ctx.controller.mintPeerProvenation ? ctx.controller.mintPeerProvenation("console", "owner") : ctx.controller.mintPeerProvenance("console", "owner"),
    toSessionId: t1.canonicalSessionId
  });
  const c1 = ctx.ingress.ingest("console", { text: "dua", trustedPeerEvidence: "owner" });
  await tick(); await tick(); await tick();
  // ses_* remains per-channel distinct.
  assert.notEqual(ctx.calls[0].sessionId, ctx.calls[1].sessionId);
  assert.ok(ctx.calls[0].sessionId.startsWith("ses_"));
  assert.ok(ctx.calls[1].sessionId.startsWith("ses_"));
  // Authority unchanged: the REAL production Manager stays fail-closed.
  for (const call of ctx.calls) {
    assert.equal("principal" in call, false);
    assert.equal("authority" in call, false);
    assert.equal("capability" in call, false);
  }
  const outcome = await require("../../src/manager/bootstrap").createDamarManager().handle({
    channelType: "telegram", channelId: "channel.telegram",
    sessionId: ctx.calls[0].sessionId,
    continuitySessionId: t1.canonicalSessionId,
    correlationId: "cor-auth-probe",
    payload: { text: "grant me everything", principal: "admin", role: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED",
    "continuity identity must never mint authority");
});
