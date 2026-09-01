"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (part 2: canonical ingress).
 *
 * Covers required scenarios 11–20 through the REAL canonical path:
 *   channel → ingress (RuntimeHost composition seam) → InteractionBus → Manager
 *
 *  11. cancellation before restart remains terminal
 *  12. expired/invalid resume state is rejected/degraded safely
 *  13. malformed persisted data fails closed
 *  14. bounded persistence / oversized state rejected
 *  15. canonical Manager ingress remains used
 *  16. VoiceRuntime still uses canonical ingress
 *  17. paid/cloud fallback behavior from Lane 3 does not change
 *  18. Manager composition count/provenance does not change
 *  19. cross-channel binding does not mint authority
 *  20. focused test processes naturally terminate
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ib = require("../../src/runtime/interactionBus");
const { createManagerInteractionIngress } = require("../../src/runtime/interactionBus/managerIngressInternal");
const { createMediaContextAuthority } = require("../../src/manager/internal/mediaContext");
const {
  createSessionContinuity,
  createSequentialContinuityIdFactory,
  createMemoryContinuityStore,
  createFileContinuityStore,
  validateSnapshot,
  SNAPSHOT_LIMITS
} = require("../../src/runtime/sessionContinuity");

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeManager() {
  const calls = [];
  return {
    calls,
    async handle(input) {
      calls.push(input);
      return Object.freeze({
        managerRequestId: `req-${calls.length}`,
        outcome: "COMPLETED",
        lifecycleState: "COMPLETED",
        detail: `echo:${input.payload.text}`
      });
    },
    cancel() { return Object.freeze({ ok: true }); }
  };
}

function makeIngress(options = {}) {
  let now = options.now === undefined ? 1000 : options.now;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  const manager = makeManager();
  const continuity = options.sessionContinuity === undefined
    ? createSessionContinuity({
        clock,
        idFactory: createSequentialContinuityIdFactory(),
        store: options.store || createMemoryContinuityStore()
      })
    : options.sessionContinuity;
  const mediaContextAuthority = createMediaContextAuthority();
  const ingress = createManagerInteractionIngress({
    bus,
    manager,
    mediaContextMint: mediaContextAuthority.mint,
    sessionContinuity: continuity
  });
  return { bus, manager, continuity, ingress, advance: (ms) => { now += ms; } };
}

// ---------------------------------------------------------------------------
// 15. canonical Manager ingress remains used (+ cross-channel via ingress)
// ---------------------------------------------------------------------------

test("15: continuity events still flow through the canonical Manager ingress", async () => {
  const { ingress, manager } = makeIngress();
  const first = ingress.ingest("console", { text: "halo", userId: "u1" });
  assert.equal(first.accepted, true);
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  await tick();
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "console");
});

test("15b: channel A → channel B continuity through canonical ingress", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const first = ingress.ingest("telegram", { text: "mulai di telegram", userId: "u1" });
  await tick();
  assert.equal(manager.calls.length, 1);
  const canonicalId = first.canonicalSessionId;

  // The user switches channel: same peer evidence on WhatsApp. Unify the
  // canonical session across channels via the binding policy (runtime act).
  continuity.bindChannel({ sessionId: canonicalId, channel: "whatsapp", claimedIdentity: "u1" });
  const second = ingress.ingest("whatsapp", { text: "lanjut di whatsapp", userId: "u1" });
  await tick();
  assert.equal(second.accepted, true, "channel B must be accepted on its own transport-scoped bus session");
  assert.equal(second.canonicalSessionId, canonicalId, "channel B must resolve to the SAME canonical session");
  assert.equal(manager.calls.length, 2);
  assert.equal(manager.calls[1].channelType, "whatsapp");
  // The canonical identity is the UNIFIED conversation identity.
  const snapshot = continuity.getSession(canonicalId);
  assert.deepEqual(snapshot.channels.map((c) => c.channel).sort(), ["telegram", "whatsapp"]);
});

test("15c: two different peers on the same channel get DISTINCT canonical sessions", async () => {
  const { ingress } = makeIngress();
  const a = ingress.ingest("telegram", { text: "saya alice", userId: "alice" });
  const b = ingress.ingest("telegram", { text: "saya bob", userId: "bob" });
  await tick();
  assert.notEqual(a.canonicalSessionId, b.canonicalSessionId);
});

test("15d: WITHOUT continuity injection, ingress behaves exactly as before", async () => {
  const bus = ib.createInteractionBus({ clock: () => 1000, idFactory: ib.createSequentialIdFactory() });
  const manager = makeManager();
  const ingress = createManagerInteractionIngress({
    bus, manager, mediaContextMint: createMediaContextAuthority().mint
  });
  const result = ingress.ingest("console", { text: "klasik", userId: "u" });
  assert.equal(result.accepted, true);
  assert.equal("canonicalSessionId" in result, false);
  await tick();
  assert.equal(manager.calls.length, 1);
});

test("15e: cross-channel events never collide on the transport-scoped bus session", async () => {
  // The bus one-transport-per-session law is untouched: channel A and
  // channel B each keep their own bus session while sharing the canonical
  // Damar identity.  Re-submitting on the same channel is stable.
  const { ingress, manager } = makeIngress();
  const a1 = ingress.ingest("telegram", { text: "satu", userId: "u1" });
  const a2 = ingress.ingest("telegram", { text: "dua", userId: "u1" });
  await tick();
  assert.equal(a1.accepted, true);
  assert.equal(a2.accepted, true);
  assert.equal(a1.canonicalSessionId, a2.canonicalSessionId);
  assert.equal(manager.calls.length, 2);
});

// ---------------------------------------------------------------------------
// 19. cross-channel binding does not mint authority
// ---------------------------------------------------------------------------

test("19: cross-channel binding mints no authority — Manager principal path unchanged", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const first = ingress.ingest("console", { text: "hi", userId: "u1" });
  await tick();
  const canonicalId = first.canonicalSessionId;
  continuity.bindChannel({ sessionId: canonicalId, channel: "telegram", claimedIdentity: "u1" });
  const fromTelegram = ingress.ingest("telegram", { text: "dari telegram", userId: "u1" });
  await tick();

  // The Manager input carries channel provenance and transport-scoped
  // session identity ONLY — never a principal, authority, or capability.
  assert.equal(manager.calls[1].channelType, "telegram");
  assert.equal("principal" in manager.calls[1], false, "ingress must never set a principal");
  assert.equal("authority" in manager.calls[1], false);
  assert.equal("capability" in manager.calls[1], false);
  // Cross-channel events remain on canonical ingress with a stable id shape.
  assert.ok(manager.calls[1].sessionId.startsWith("ses_"));

  // The continuity facade exposes no authority-minting surface.
  for (const key of Object.keys(continuity)) {
    assert.match(key, /^(createSession|getSession|bindChannel|resolveChannel|restore|resumeSession|closeSession|persist|currentIncarnation|applyWithIncarnation|recordTerminalInteraction|getTerminalInteraction|acceptAsyncOutcome|snapshotDiagnostics|shutdown)$/);
  }
});

test("19b: forged channel metadata in the raw event cannot hijack a canonical session", async () => {
  const { ingress } = makeIngress();
  const victim = ingress.ingest("telegram", { text: "victim", userId: "victim" });
  await tick();
  const victimCanonical = victim.canonicalSessionId;
  // Attacker claims the victim's canonical session id through their own peer
  // evidence on the same channel — resolution is by binding policy, and the
  // attacker's peer has no binding to the victim's session.
  const attacker = ingress.ingest("telegram", {
    text: "hijack", userId: "attacker", sessionId: victimCanonical
  });
  await tick();
  assert.notEqual(attacker.canonicalSessionId, victimCanonical);
});

test("19c: claiming a foreign dsc id with no binding never resolves another session", () => {
  const { continuity } = makeIngress();
  const victim = continuity.createSession({});
  continuity.bindChannel({ sessionId: victim.sessionId, channel: "telegram", claimedIdentity: "victim" });
  const forged = continuity.resolveChannel({
    channel: "telegram", claimedIdentity: "someone-else", claimedSessionId: victim.sessionId
  });
  assert.equal(forged.resolved, false);
});

// ---------------------------------------------------------------------------
// 12/13/14. invalid/expired/malformed/oversized persisted state fails closed
// ---------------------------------------------------------------------------

test("12: corrupt persisted snapshot degrades safely (fresh domain, no resurrection)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-c-degraded-"));
  const file = path.join(dir, "continuity.json");
  fs.writeFileSync(file, "{ not json !!!", "utf8");
  const t = makeIngress({ store: createFileContinuityStore(file) });
  const result = await t.continuity.restore();
  assert.equal(result.restored, false);
  assert.equal(result.degraded, true);
  // The domain continues operating with fresh state (no stale resurrect).
  const created = t.continuity.createSession({});
  assert.ok(created.sessionId.startsWith("dsc_"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("13: malformed snapshot data fails closed (validator)", () => {
  const bad = (snapshot) => {
    const verdict = validateSnapshot(snapshot);
    assert.equal(verdict.corrupt, true, JSON.stringify(String(snapshot)).slice(0, 80));
  };
  bad(null);
  bad(undefined);
  bad("string");
  bad(42);
  bad([]);
  bad({});
  bad({ schemaVersion: 2, savedAt: 1, sessions: [], terminal: {} });
  bad({ schemaVersion: 1, savedAt: -1, sessions: [], terminal: {} });
  bad({ schemaVersion: 1, savedAt: 1, sessions: {}, terminal: {} });
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "not-a-dsc-id", createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null, channels: []
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 10, updatedAt: 5, incarnation: 1,
      resumeMetadata: null, terminalAt: null, channels: []
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 1, updatedAt: 1, incarnation: 0,
      resumeMetadata: null, terminalAt: null, channels: []
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: { "bad-key!": 1 }, terminalAt: null, channels: []
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null,
      channels: [{ channel: "UPPER", peerKey: "p", boundAt: 1, generation: 1 }]
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [],
    terminal: { "not-ix": { state: "COMPLETED", generation: 1, at: 1 } }
  });
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [],
    terminal: { ix_x: { state: "STILL_RUNNING", generation: 1, at: 1 } }
  });
  // Unknown extra fields are forbidden (closed schema).
  bad({ schemaVersion: 1, savedAt: 1, sessions: [], terminal: {}, extra: true });
});

test("13b: a structurally valid snapshot with an unknown session field fails closed", () => {
  const verdict = validateSnapshot({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null, channels: [], smuggled: "x"
    }]
  });
  assert.equal(verdict.corrupt, true);
});

test("14: oversized snapshots are rejected by the store and by the validator", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-c-oversize-"));
  const file = path.join(dir, "continuity.json");
  const store = createFileContinuityStore(file);
  // Build a snapshot exceeding the byte bound.
  const sessions = [];
  for (let i = 0; i < SNAPSHOT_LIMITS.maxSessions + 10; i += 1) {
    sessions.push({
      sessionId: `dsc_${String(i).padStart(12, "0")}`,
      createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null, channels: []
    });
  }
  const oversized = { schemaVersion: 1, savedAt: 1, sessions, terminal: {} };
  await assert.rejects(() => store.persist(oversized), (error) => error.code === "SNAPSHOT_TOO_LARGE");
  assert.equal(validateSnapshot(oversized).corrupt, true);
  assert.equal(validateSnapshot(oversized).reason, "SNAPSHOT_SESSIONS_OVERFLOW");

  // On-disk oversized file fails closed on load.
  fs.writeFileSync(file, JSON.stringify(oversized), "utf8");
  const loaded = await store.load();
  assert.equal(loaded.corrupt, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("14b: session and binding limits fail closed", () => {
  const domain = createSessionContinuity({
    clock: () => 1000,
    idFactory: createSequentialContinuityIdFactory(),
    store: createMemoryContinuityStore()
  });
  // Fill to the default session bound.
  let created = 0;
  try {
    for (let i = 0; i < 300; i += 1) {
      domain.createSession({});
      created += 1;
    }
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "SESSION_LIMIT_EXCEEDED");
    assert.equal(created, 256);
  }
});

// ---------------------------------------------------------------------------
// 11. cancellation before restart remains terminal
// ---------------------------------------------------------------------------

test("11: cancellation before restart remains terminal after resume", async () => {
  const { bus, continuity } = makeIngress();
  const created = continuity.createSession({});
  continuity.bindChannel({ sessionId: created.sessionId, channel: "console", claimedIdentity: "u" });
  // An interaction was cancelled pre-restart; it is terminal in the ledger.
  continuity.recordTerminalInteraction({ interactionId: "ix_000000000001", state: "CANCELLED", generation: 1 });
  // Restart semantics: resume under a new incarnation.
  continuity.resumeSession({ sessionId: created.sessionId });
  // The cancelled interaction CANNOT be re-accepted or resurrected.
  const outcome = continuity.acceptAsyncOutcome({
    interactionId: "ix_000000000001", sessionId: created.sessionId,
    generation: 2, state: "COMPLETED"
  });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "ALREADY_TERMINAL");
  const replay = continuity.recordTerminalInteraction({
    interactionId: "ix_000000000001", state: "CANCELLED", generation: 2
  });
  assert.equal(replay.idempotent, true);
  // And the bus-level cancellation contract is untouched: cancellation of an
  // unknown target is still rejected by the canonical bus.
  const result = bus.requestCancellation({
    sessionId: "ses_unknown", transportId: "channel.console", targetInteractionId: "ix_000000000009"
  });
  assert.equal(result.accepted, false);
});

// ---------------------------------------------------------------------------
// 16. VoiceRuntime still uses canonical ingress
// ---------------------------------------------------------------------------

test("16: voice interaction with continuity still uses the canonical ingress path", async () => {
  const { ingress, manager } = makeIngress();
  // VoiceSession.think() calls interactionIngress.request("voice", ...) —
  // the same public contract the voice runtime uses.
  const result = await ingress.request("voice", {
    text: "jam berapa sekarang",
    userId: "owner",
    sessionId: "ses_voice-owner"
  });
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "voice");
  assert.equal(manager.calls[0].channelId, "channel.voice");
  assert.equal(result.detail, "echo:jam berapa sekarang");
});

test("16b: voice and console with the same peer evidence unify on one canonical session", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const voice = ingress.ingest("voice", { text: "halo dari suara", userId: "owner" });
  await tick();
  continuity.bindChannel({ sessionId: voice.canonicalSessionId, channel: "console", claimedIdentity: "owner" });
  const consoleEvent = ingress.ingest("console", { text: "halo dari konsol", userId: "owner" });
  await tick();
  assert.equal(consoleEvent.canonicalSessionId, voice.canonicalSessionId);
  assert.equal(manager.calls.length, 2);
  assert.equal(manager.calls[0].channelType, "voice");
  assert.equal(manager.calls[1].channelType, "console");
});

// ---------------------------------------------------------------------------
// 17. paid/cloud fallback behavior from Lane 3 does not change
// ---------------------------------------------------------------------------

test("17: Lane 3 local-first voice fallback behavior is unchanged by Lane 4", async () => {
  const oldUrl = process.env.DAMAR_TTS_URL;
  const oldFetch = global.fetch;
  process.env.DAMAR_TTS_URL = "https://paid.example/v1/audio/speech";
  let fetches = 0;
  global.fetch = async () => { fetches += 1; throw new Error("network called"); };
  const voice = require("../../src/services/voiceService");
  try {
    await assert.rejects(
      voice.speak("hello", { localOnly: true }),
      (error) => error.code === "TTS_ALL_FAILED"
    );
    assert.equal(fetches, 0, "local-only TTS must never contact the paid endpoint");
  } finally {
    if (oldUrl === undefined) delete process.env.DAMAR_TTS_URL; else process.env.DAMAR_TTS_URL = oldUrl;
    global.fetch = oldFetch;
  }
});

// ---------------------------------------------------------------------------
// 18. Manager composition count/provenance does not change
// ---------------------------------------------------------------------------

test("18: Manager composition site count and provenance are unchanged", () => {
  const fs2 = require("node:fs");
  const bootstrapSource = fs2.readFileSync(require.resolve("../../src/manager/bootstrap"), "utf8");
  assert.equal((bootstrapSource.match(/createDamarManagerComposition\s*\(\s*\{/g) || []).length, 1,
    "exactly one Manager composition site must exist in the trusted bootstrap");
  const internalSource = fs2.readFileSync(
    require.resolve("../../src/manager/internal/managerBootstrap"), "utf8"
  );
  // The internal composition file still defines exactly one composition factory.
  assert.equal((internalSource.match(/function createDamarManagerComposition/g) || []).length, 1);
  // The public Manager surface is unchanged (no new authority exports).
  const managerIndex = require("../../src/manager/index");
  assert.equal(typeof managerIndex.createDamarManager, "function");
  assert.equal("createDamarManagerComposition" in managerIndex, false);
});

// ---------------------------------------------------------------------------
// 20. focused test processes naturally terminate (no dangling handles)
// ---------------------------------------------------------------------------

test("20: continuity file store leaves no open handles after shutdown", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-c-handles-"));
  const file = path.join(dir, "continuity.json");
  const store = createFileContinuityStore(file);
  const domain = createSessionContinuity({
    clock: () => Date.now(),
    idFactory: createSequentialContinuityIdFactory(),
    store
  });
  const created = domain.createSession({});
  domain.bindChannel({ sessionId: created.sessionId, channel: "console", claimedIdentity: "u" });
  await domain.persist();
  const restored = await domain.restore();
  assert.equal(restored.restored, true);
  await domain.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
  // No lingering timers/sockets: the domain owns none by construction; this
  // test process exiting cleanly is itself part of the contract.
});

test("20b: race — two simultaneous first events on the same channel+peer converge", async () => {
  const { ingress, manager } = makeIngress();
  const a = ingress.ingest("telegram", { text: "satu", userId: "u1" });
  const b = ingress.ingest("telegram", { text: "dua", userId: "u1" });
  await tick();
  await tick();
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, true);
  assert.equal(a.canonicalSessionId, b.canonicalSessionId,
    "simultaneous first events must converge on ONE canonical session");
  assert.equal(manager.calls.length, 2);
});

test("20c: race — concurrent cross-channel unification does not duplicate sessions", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const first = ingress.ingest("console", { text: "mulai", userId: "u1" });
  await tick();
  const canonicalId = first.canonicalSessionId;
  // Two runtime acts unify the same session across channels; both resolve
  // identically afterwards.
  continuity.bindChannel({ sessionId: canonicalId, channel: "telegram", claimedIdentity: "u1" });
  const tg1 = ingress.ingest("telegram", { text: "a", userId: "u1" });
  const tg2 = ingress.ingest("telegram", { text: "b", userId: "u1" });
  await tick();
  await tick();
  assert.equal(tg1.canonicalSessionId, canonicalId);
  assert.equal(tg2.canonicalSessionId, canonicalId);
  assert.equal(manager.calls.length, 3);
  assert.equal(continuity.snapshotDiagnostics().sessions, 1);
});
