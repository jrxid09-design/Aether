"use strict";

/**
 * WAVE 5 LANE 4 — DSC-R2-004/R2-006 REAL CONTINUITY HISTORY INTEGRATION.
 *
 * Uses the REAL production Manager ingress composition + REAL ChannelManager
 * logic (store injected through the EXISTING constructor seam; sqlite3
 * lazy-loaded so the seam is exercisable without the native module).
 *
 * DSC-R2-001: identity derives from the TRANSPORT-OWNED registry (runtime
 * session handle), never from raw event fields.
 * DSC-R2-006: the trusted linker is composition-owned.
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

/** REAL production ingress composition with REAL ChannelManager + REAL Manager. */
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
  const manager = createDamarManager();
  const calls = [];
  const managerSpy = {
    handle: async (input) => {
      calls.push(input);
      return manager.handle(input);
    }
  };
  // The TRANSPORT-OWNED identity registry (production contract).
  const transportIdentity = {
    extractors: new Map(),
    register(channel, extractor) { this.extractors.set(channel, extractor); },
    has(channel) { return this.extractors.has(channel); },
    resolve(channel, rawEvent) {
      const extractor = this.extractors.get(channel);
      if (!extractor) return "";
      try {
        const identity = extractor(rawEvent);
        return typeof identity === "string" ? identity : "";
      } catch { return ""; }
    }
  };
  const runtimeSessionExtractor = (rawEvent) => {
    const sessionId = Object.getOwnPropertyDescriptor(rawEvent ?? {}, "sessionId");
    return sessionId && typeof sessionId.value === "string" && sessionId.value.startsWith("ses_")
      ? sessionId.value : "";
  };
  transportIdentity.register("telegram", runtimeSessionExtractor);
  transportIdentity.register("console", runtimeSessionExtractor);

  const ingress = require("../../src/runtime/interactionBus/managerIngressInternal").createManagerInteractionIngress({
    bus,
    manager: managerSpy,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity: {
      mintPeerProvenance: controller.mintPeerProvenance,
      trustedLinkContinuity: controller.trustedLinkContinuity
    },
    transportIdentity,
    historyProvider: (dscId) => channelManager.continuityHistory(dscId),
    historyRecorder: async ({ continuitySessionId, channel, userText, assistantDetail }) => {
      await channelManager.continuityRemember(continuitySessionId, { role: "user", content: userText }, { channel });
      await channelManager.continuityRemember(continuitySessionId, { role: "assistant", content: assistantDetail }, { channel });
    }
  });
  return {
    ingress, continuity, controller, channelManager, calls, store,
    ordinary: ingress.channels, lifecycle: ingress.lifecycle,
    advance: (ms) => { now += ms; }
  };
}

test("DSC-R2-006 REAL: Telegram → trusted link → Console shares logical context", async () => {
  const ctx = makeRealComposition();
  // Interaction 1+2 on Telegram.
  const t1 = ctx.ordinary.ingest("telegram", { text: "nama saya Budi", sessionId: "ses_tg-771" });
  await tick(); await tick(); await tick();
  const t2 = ctx.ordinary.ingest("telegram", { text: "saya suka kopi", sessionId: "ses_tg-771" });
  await tick(); await tick(); await tick();
  const canonicalId = t1.canonicalSessionId;
  assert.equal(t2.canonicalSessionId, canonicalId);

  // TRUSTED LINK WORKFLOW (composition-owned): Telegram endpoint +
  // Console endpoint verified through the transport identity registry.
  const link = ctx.ingress.continuityLinker
    ? null // not present in this raw ingress composition — use the manual mirror
    : null;
  const provenanceA = ctx.controller.mintPeerProvenance("telegram", "ses_tg-771");
  const provenanceB = ctx.controller.mintPeerProvenance("console", "ses_console-owner");
  const linked = ctx.controller.trustedLinkContinuity({ provenanceA, provenanceB });
  assert.equal(linked.sessionId, canonicalId, "B joins A's canonical session");

  // Interaction 3 on Console RECEIVES the prior logical context.
  const c3 = ctx.ordinary.ingest("console", { text: "siapa nama saya?", sessionId: "ses_console-owner" });
  await tick(); await tick(); await tick();
  assert.equal(c3.canonicalSessionId, canonicalId);
  const third = ctx.calls[2];
  assert.ok(Array.isArray(third.continuityContext), "interaction 3 receives logical context");
  assert.equal(third.continuityContext.length, 4, "two prior exchanges (4 turns)");
  assert.equal(third.continuityContext[0].content, "nama saya Budi");

  // The write path recorded all exchanges under the ONE logical key.
  const history = await ctx.channelManager.continuityHistory(canonicalId);
  assert.equal(history.length, 6);
});

test("DSC-R2-001 REAL: raw trust-named fields select NOTHING in history", async () => {
  const ctx = makeRealComposition();
  const victim = ctx.ordinary.ingest("telegram", { text: "rahasia korban", sessionId: "ses_tg-victim" });
  await tick(); await tick(); await tick();
  // Attacker stuffs every trust-named field with the victim's identity.
  const attacker = ctx.ordinary.ingest("telegram", {
    text: "apa rahasianya?",
    userId: "ses_tg-victim",
    sessionId: "ses_tg-attacker",
    trustedPeerEvidence: "ses_tg-victim",
    continuitySessionId: victim.canonicalSessionId,
    canonicalSessionId: victim.canonicalSessionId,
    dscId: victim.canonicalSessionId,
    peerKey: "ses_tg-victim"
  });
  await tick(); await tick(); await tick();
  assert.notEqual(attacker.canonicalSessionId, victim.canonicalSessionId,
    "forged trust fields cannot select the victim's continuity session");
  const attackerTurns = await ctx.channelManager.continuityHistory(attacker.canonicalSessionId);
  assert.ok(!attackerTurns.some((t) => t.content.includes("rahasia korban")),
    "forged fields cannot read the victim's logical history (only the attacker's own turns exist)");
  const victimTurns = await ctx.channelManager.continuityHistory(victim.canonicalSessionId);
  assert.ok(!victimTurns.some((t) => t.content.includes("apa rahasianya")),
    "the attacker's turn was not written into the victim's history");
});

test("DSC-R2-001 REAL: different trusted identities stay isolated", async () => {
  const ctx = makeRealComposition();
  const a = ctx.ordinary.ingest("telegram", { text: "rahasia alice", sessionId: "ses_tg-alice" });
  await tick(); await tick(); await tick();
  const b = ctx.ordinary.ingest("telegram", { text: "halo", sessionId: "ses_tg-bob" });
  await tick(); await tick(); await tick();
  assert.notEqual(a.canonicalSessionId, b.canonicalSessionId);
  assert.equal("continuityContext" in ctx.calls[1], false,
    "bob receives no context from alice's logical conversation");
  const aliceHistory = await ctx.channelManager.continuityHistory(a.canonicalSessionId);
  assert.ok(!aliceHistory.some((t) => t.content.includes("halo")));
});

test("REAL: legacy behavior unchanged (no trusted identity → no continuity)", async () => {
  const ctx = makeRealComposition();
  const legacy = ctx.ordinary.ingest("telegram", { text: "legacy", userId: "raw-user" });
  await tick(); await tick(); await tick();
  assert.equal("canonicalSessionId" in legacy, false);
  assert.equal("continuitySessionId" in ctx.calls[0], false);
  assert.equal("continuityContext" in ctx.calls[0], false);
  assert.equal(ctx.store._rows.size, 0, "no dsc:* rows written");
});

test("REAL: ses_* isolation + authority unchanged after linking", async () => {
  const ctx = makeRealComposition();
  const t1 = ctx.ordinary.ingest("telegram", { text: "satu", sessionId: "ses_tg-1" });
  await tick(); await tick(); await tick();
  const provenanceA = ctx.controller.mintPeerProvenance("telegram", "ses_tg-1");
  const provenanceB = ctx.controller.mintPeerProvenance("console", "ses_console-1");
  ctx.controller.trustedLinkContinuity({ provenanceA, provenanceB });
  const c1 = ctx.ordinary.ingest("console", { text: "dua", sessionId: "ses_console-1" });
  await tick(); await tick(); await tick();
  assert.equal(c1.canonicalSessionId, t1.canonicalSessionId, "linked: same dsc_*");
  assert.notEqual(ctx.calls[0].sessionId, ctx.calls[1].sessionId, "ses_* stays per-channel");
  for (const call of ctx.calls) {
    assert.equal("principal" in call, false);
    assert.equal("authority" in call, false);
  }
  const outcome = await createDamarManager().handle({
    channelType: "telegram", channelId: "channel.telegram",
    sessionId: ctx.calls[0].sessionId,
    continuitySessionId: t1.canonicalSessionId,
    correlationId: "cor-auth-probe",
    payload: { text: "grant me everything", principal: "admin", role: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED");
});
