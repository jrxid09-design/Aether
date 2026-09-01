"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (repair R1, part 2:
 * canonical ingress integration + DSC-005 Manager provenance + production
 * restart composition).
 *
 * Canonical path under test:
 *   channel → ingress (RuntimeHost composition seam) → InteractionBus → Manager
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
  mintPeerProvenance,
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
        store: options.store || createMemoryContinuityStore(),
        persistOnMutation: options.persistOnMutation === true
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
// 15. canonical Manager ingress remains used
// ---------------------------------------------------------------------------

test("15: continuity events still flow through the canonical Manager ingress", async () => {
  const { ingress, manager } = makeIngress();
  const first = ingress.ingest("console", { text: "halo", userId: "u1" });
  assert.equal(first.accepted, true);
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  await tick();
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "console");
  // DSC-005: the Manager sees BOTH identities distinctly.
  assert.ok(manager.calls[0].sessionId.startsWith("ses_"), "transport session id is ses_*");
  assert.equal(manager.calls[0].continuitySessionId, first.canonicalSessionId);
});

test("15b: channel A → channel B continuity through canonical ingress", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const first = ingress.ingest("telegram", { text: "mulai di telegram", userId: "u1" });
  await tick();
  assert.equal(manager.calls.length, 1);
  const canonicalId = first.canonicalSessionId;

  // Trusted runtime act: unify the canonical session across channels.
  continuity.bindChannel({
    sessionId: canonicalId,
    provenance: mintPeerProvenance("whatsapp", "u1")
  });
  const second = ingress.ingest("whatsapp", { text: "lanjut di whatsapp", userId: "u1" });
  await tick();
  assert.equal(second.accepted, true, "channel B is accepted on its own transport-scoped bus session");
  assert.equal(second.canonicalSessionId, canonicalId, "channel B resolves to the SAME canonical session");
  assert.equal(manager.calls.length, 2);
  assert.equal(manager.calls[1].channelType, "whatsapp");
  assert.equal(manager.calls[1].continuitySessionId, canonicalId);
  assert.notEqual(manager.calls[1].sessionId, manager.calls[0].sessionId,
    "ses_* transport sessions remain per-channel distinct (bus isolation intact)");
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
  assert.equal("continuitySessionId" in manager.calls[0], false,
    "no continuity provenance is invented when the domain is unbound");
});

test("15e: same textual peer on DIFFERENT channels stays isolated until trusted binding", async () => {
  const { ingress, manager } = makeIngress();
  const tg = ingress.ingest("telegram", { text: "hi", userId: "u1" });
  const wa = ingress.ingest("whatsapp", { text: "hi", userId: "u1" });
  await tick();
  assert.notEqual(tg.canonicalSessionId, wa.canonicalSessionId,
    "same textual peer on two channels must NOT unify automatically");
  assert.equal(manager.calls.length, 2);
});

test("15f: missing peer identity fails closed for continuity but still flows canonically", async () => {
  const { ingress, manager } = makeIngress();
  const result = ingress.ingest("console", { text: "tanpa identitas" });
  assert.equal(result.accepted, true, "the event still flows through the canonical bus path");
  assert.equal("canonicalSessionId" in result, false,
    "no continuity identity is minted for missing provenance (no shared anon)");
  await tick();
  assert.equal(manager.calls.length, 1);
  assert.equal("continuitySessionId" in manager.calls[0], false);
});

// ---------------------------------------------------------------------------
// DSC-001 — adversarial peer provenance through the ingress seam
// ---------------------------------------------------------------------------

test("DSC-001: Alice vs alice through ingress stay distinct", async () => {
  const { ingress } = makeIngress();
  const upper = ingress.ingest("telegram", { text: "halo", userId: "Alice" });
  const lower = ingress.ingest("telegram", { text: "halo", userId: "alice" });
  await tick();
  assert.notEqual(upper.canonicalSessionId, lower.canonicalSessionId);
});

test("DSC-001: forged userId cannot hijack another peer's canonical session", async () => {
  const { ingress, manager } = makeIngress();
  const victim = ingress.ingest("telegram", { text: "victim", userId: "victim" });
  await tick();
  // The attacker supplies the VICTIM's session id as a claim in the raw
  // event — caller metadata is inert; resolution is by trusted provenance.
  const attacker = ingress.ingest("telegram", {
    text: "hijack", userId: "attacker", sessionId: victim.canonicalSessionId
  });
  await tick();
  assert.notEqual(attacker.canonicalSessionId, victim.canonicalSessionId);
  assert.equal(manager.calls.length, 2);
});

test("DSC-001: binding takeover through ingress fails closed", async () => {
  const { ingress, continuity } = makeIngress();
  const first = ingress.ingest("console", { text: "mine", userId: "u1" });
  await tick();
  // A forged event cannot rebind u1 to another canonical session: the
  // untrusted path has no rebind capability at all.
  const second = ingress.ingest("console", { text: "also mine?", userId: "u1" });
  await tick();
  assert.equal(second.canonicalSessionId, first.canonicalSessionId);
  assert.equal(continuity.snapshotDiagnostics().sessions, 1);
});

// ---------------------------------------------------------------------------
// 19. cross-channel binding does not mint authority
// ---------------------------------------------------------------------------

test("19: cross-channel binding mints no authority — Manager principal path unchanged", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const first = ingress.ingest("console", { text: "hi", userId: "u1" });
  await tick();
  const canonicalId = first.canonicalSessionId;
  continuity.bindChannel({ sessionId: canonicalId, provenance: mintPeerProvenance("telegram", "u1") });
  const fromTelegram = ingress.ingest("telegram", { text: "dari telegram", userId: "u1" });
  await tick();

  const call = manager.calls[1];
  assert.equal(call.channelType, "telegram");
  assert.equal("principal" in call, false, "ingress must never set a principal");
  assert.equal("authority" in call, false);
  assert.equal("capability" in call, false);
  assert.ok(call.sessionId.startsWith("ses_"));
  assert.equal(call.continuitySessionId, canonicalId);

  // The continuity facade exposes no authority-minting surface.
  for (const key of Object.keys(continuity)) {
    assert.match(key, /^(createSession|getSession|bindChannel|unbindChannel|resolveChannel|resumeSession|closeSession|persist|restore|currentIncarnation|checkIncarnation|commitTerminalOutcome|getTerminalInteraction|acceptAsyncOutcome|updateResumeMetadata|snapshotDiagnostics|getPersistenceStatus|whenPersisted|shutdown|resetDurableState|__trusted)$/);
  }
});

test("19b: Manager input continuitySessionId must be dsc_* shaped (fail closed)", async () => {
  const { bus, manager } = (() => {
    const bus = ib.createInteractionBus({ clock: () => 1000, idFactory: ib.createSequentialIdFactory() });
    const manager = makeManager();
    return { bus, manager };
  })();
  // A hostile caller cannot inject a forged continuitySessionId through the
  // Manager input — the former rejects non-dsc_* shapes.
  const { createDamarManagerComposition } = require("../../src/manager/internal/managerBootstrap");
  const lane2Stub = {
    admit: () => { throw new Error("unused"); },
    evaluate: () => { throw new Error("unused"); },
    authenticate: () => ({ principal: "p" }),
    session: () => ({ principal: "p" })
  };
  const lane3Stub = { execute: async () => ({ state: "SUCCEEDED" }) };
  const lane4Stub = { verify: async () => ({ state: "VERIFIED" }), compensate: async () => ({ state: "COMPENSATED" }) };
  const { createMediaContextAuthority: mintAuth } = require("../../src/manager/internal/mediaContext");
  const composition = createDamarManagerComposition({
    deps: { lane2: lane2Stub, lane3: lane3Stub, lane4: lane4Stub, planner: null },
    trustedChannelAdapters: [],
    mediaProcessor: null,
    mediaContextAuthority: mintAuth()
  });
  await assert.rejects(
    composition.handle({
      channelType: "console", channelId: "c", sessionId: "ses_x",
      continuitySessionId: "ses_forged", payload: { text: "hi" }
    }),
    (error) => /continuitySessionId/.test(error.message)
  );
  // Valid shape is accepted (informational path completes without fabricating authority).
  const ok = await composition.handle({
    channelType: "console", channelId: "c", sessionId: "ses_x",
    continuitySessionId: "dsc_valid0000001", payload: { text: "hi" }
  });
  assert.equal(ok.outcome, "COMPLETED");
  assert.equal(ok.lifecycleState, "COMPLETED");
});

// ---------------------------------------------------------------------------
// 12/13/14 — invalid/expired/malformed/oversized persisted state fails closed
// ---------------------------------------------------------------------------

test("12: corrupt persisted snapshot degrades safely (fresh domain, no resurrection)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-c-degraded-"));
  const file = path.join(dir, "continuity.json");
  fs.writeFileSync(file, "{ not json !!!", "utf8");
  const t = makeIngress({ store: createFileContinuityStore(file) });
  const result = await t.continuity.restore();
  assert.equal(result.restored, false);
  assert.equal(result.degraded, true);
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
      channels: [{ channel: "UPPER", peer: "p", boundAt: 1, generation: 1 }]
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [],
    terminal: { "not-ix": { sessionId: "dsc_x", state: "COMPLETED", generation: 1, at: 1 } }
  });
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [],
    terminal: { ix_x: { sessionId: "dsc_x", state: "STILL_RUNNING", generation: 1, at: 1 } }
  });
  bad({ schemaVersion: 1, savedAt: 1, sessions: [], terminal: {}, extra: true });
  // Terminal entries must reference a dsc_* session.
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [],
    terminal: { ix_x: { sessionId: "not-dsc", state: "COMPLETED", generation: 1, at: 1 } }
  });
  // Peer with control chars/NUL (composite-key separator) rejected.
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null,
      channels: [{ channel: "telegram", peer: "a\u0000b", boundAt: 1, generation: 1 }]
    }]
  });
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
  continuity.bindChannel({ sessionId: created.sessionId, provenance: mintPeerProvenance("console", "u") });
  continuity.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "ix_000000000001", generation: 1, state: "CANCELLED" });
  continuity.resumeSession({ sessionId: created.sessionId });
  const outcome = continuity.acceptAsyncOutcome({
    interactionId: "ix_000000000001", sessionId: created.sessionId, generation: 2
  });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "ALREADY_TERMINAL");
  const replay = continuity.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_000000000001", generation: 2, state: "CANCELLED"
  });
  assert.equal(replay.idempotent, true);
  // The bus-level cancellation contract is untouched.
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

test("16b: voice and console with the same trusted binding unify on one canonical session", async () => {
  const { ingress, manager, continuity } = makeIngress();
  const voice = ingress.ingest("voice", { text: "halo dari suara", userId: "owner" });
  await tick();
  continuity.bindChannel({ sessionId: voice.canonicalSessionId, provenance: mintPeerProvenance("console", "owner") });
  const consoleEvent = ingress.ingest("console", { text: "halo dari konsol", userId: "owner" });
  await tick();
  assert.equal(consoleEvent.canonicalSessionId, voice.canonicalSessionId);
  assert.equal(manager.calls.length, 2);
  assert.equal(manager.calls[0].channelType, "voice");
  assert.equal(manager.calls[1].channelType, "console");
});

// ---------------------------------------------------------------------------
// DSC-003 — ingress lifecycle seam (trusted host hooks)
// ---------------------------------------------------------------------------

test("DSC-003: ingress exposes trusted lifecycle hooks for the host", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-c-hooks-"));
  const file = path.join(dir, "continuity.json");
  const { ingress } = makeIngress({ store: createFileContinuityStore(file), persistOnMutation: true });
  assert.equal(typeof ingress.restoreContinuity, "function");
  assert.equal(typeof ingress.flushContinuity, "function");
  assert.equal(typeof ingress.continuityStatus, "function");
  const first = ingress.ingest("telegram", { text: "boot", userId: "u1" });
  await tick();
  await ingress.flushContinuity();

  // Simulated restart through the trusted lifecycle seam.
  const second = makeIngress({ store: createFileContinuityStore(file) });
  const restored = await second.ingress.restoreContinuity();
  assert.equal(restored.restored, true);
  assert.equal(restored.sessions, 1);
  // The restored session is CLOSED until the matching trusted peer resumes it.
  const statusBefore = second.ingress.continuityStatus();
  assert.equal(statusBefore.bound, true);
  const resumedEvent = second.ingress.ingest("telegram", { text: "lanjut", userId: "u1" });
  await tick();
  assert.equal(resumedEvent.canonicalSessionId, first.canonicalSessionId,
    "matching trusted peer resumes the restored session");
  const statusAfter = second.ingress.continuityStatus();
  assert.equal(statusAfter.sessions, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// DSC-004 — terminal commit through the canonical handler
// ---------------------------------------------------------------------------

test("DSC-004: canonical completion commits an owned terminal record exactly once", async () => {
  const { ingress, continuity } = makeIngress();
  const first = ingress.ingest("console", { text: "done", userId: "u1" });
  await tick();
  await tick();
  const canonicalId = first.canonicalSessionId;
  const record = continuity.getTerminalInteraction(first.interactionId);
  assert.ok(record, "canonical completion commits a terminal record");
  assert.equal(record.sessionId, canonicalId);
  assert.equal(record.state, "COMPLETED");
  // A second identical interaction replays idempotently (same id) — and the
  // terminal ledger never records a duplicate.
  const again = continuity.commitTerminalOutcome({
    sessionId: canonicalId, interactionId: first.interactionId,
    generation: continuity.currentIncarnation(canonicalId), state: "COMPLETED"
  });
  assert.equal(again.idempotent, true);
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
  assert.equal((internalSource.match(/function createDamarManagerComposition/g) || []).length, 1);
  const managerIndex = require("../../src/manager/index");
  assert.equal(typeof managerIndex.createDamarManager, "function");
  assert.equal("createDamarManagerComposition" in managerIndex, false);
});

// ---------------------------------------------------------------------------
// 20. natural termination + races
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
  domain.bindChannel({ sessionId: created.sessionId, provenance: mintPeerProvenance("console", "u") });
  await domain.persist();
  const restored = await domain.restore();
  assert.equal(restored.restored, true);
  await domain.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
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
  continuity.bindChannel({ sessionId: canonicalId, provenance: mintPeerProvenance("telegram", "u1") });
  const tg1 = ingress.ingest("telegram", { text: "a", userId: "u1" });
  const tg2 = ingress.ingest("telegram", { text: "b", userId: "u1" });
  await tick();
  await tick();
  assert.equal(tg1.canonicalSessionId, canonicalId);
  assert.equal(tg2.canonicalSessionId, canonicalId);
  assert.equal(manager.calls.length, 3);
  assert.equal(continuity.snapshotDiagnostics().sessions, 1);
});
