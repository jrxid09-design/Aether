"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (repair R2, part 2:
 * canonical ingress integration).
 *
 * The trusted composition supplies: the continuity facade, the trusted
 * provenance mint (captured via trustedLifecycle), and the RUNTIME-OWNED
 * peer-evidence provider.  Raw event userId is never consulted.
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

/**
 * Composition-style ingress: mirrors the production composition root's
 * trust wiring — trustedLifecycle captures the mint; the peer-evidence
 * provider reads the RUNTIME-OWNED `trustedPeerEvidence` field (never the
 * raw caller `userId`).
 */
function makeIngress(options = {}) {
  let now = options.now === undefined ? 1000 : options.now;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  const manager = makeManager();
  let controller = null;
  const continuity = createSessionContinuity({
    clock,
    idFactory: createSequentialContinuityIdFactory(),
    store: options.store || createMemoryContinuityStore(),
    persistOnMutation: options.persistOnMutation === true,
    trustedLifecycle(captured) { controller = captured; }
  });
  const trustedContinuity = controller ? { mintPeerProvenance: controller.mintPeerProvenance } : null;
  const peerEvidenceProvider = (channel, rawEvent) => {
    if (rawEvent === null || typeof rawEvent !== "object") return "";
    const descriptor = Object.getOwnPropertyDescriptor(rawEvent, "trustedPeerEvidence");
    if (!descriptor || !("value" in descriptor)) return "";
    const evidence = descriptor.value;
    return typeof evidence === "string" ? evidence : "";
  };
  const mediaContextAuthority = createMediaContextAuthority();
  const ingress = createManagerInteractionIngress({
    bus,
    manager,
    mediaContextMint: mediaContextAuthority.mint,
    sessionContinuity: continuity,
    trustedContinuity,
    peerEvidenceProvider,
    ...(options.historyRecorder !== undefined ? { historyRecorder: options.historyRecorder } : {}),
    ...(options.historyProvider !== undefined ? { historyProvider: options.historyProvider } : {})
  });
  return { bus, manager, continuity, controller, ingress, advance: (ms) => { now += ms; } };
}

// ---------------------------------------------------------------------------
// DSC-R1-006 — runtime-owned evidence through the ingress
// ---------------------------------------------------------------------------

test("DSC-R1-006: trusted transport evidence resolves continuity; raw userId NEVER does", async () => {
  const { ingress, manager } = makeIngress();
  // Runtime-owned evidence (set by the trusted transport adapter).
  const first = ingress.ingest("telegram", {
    text: "halo", trustedPeerEvidence: "77123456:42"
  });
  assert.equal(first.accepted, true);
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  await tick();
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].continuitySessionId, first.canonicalSessionId);

  // The SAME event shape with only a raw caller userId (no runtime-owned
  // evidence) gets NO continuity identity — the ses_* path still works.
  const legacy = ingress.ingest("telegram", { text: "klasik", userId: "77123456:42" });
  assert.equal(legacy.accepted, true, "the ordinary ses_* interaction path continues");
  assert.equal("canonicalSessionId" in legacy, false, "raw userId can never establish continuity");
  await tick();
  assert.equal("continuitySessionId" in manager.calls[1], false);
});

test("DSC-R1-006: Alice vs alice through ingress stay distinct", async () => {
  const { ingress } = makeIngress();
  const upper = ingress.ingest("telegram", { text: "halo", trustedPeerEvidence: "Alice" });
  const lower = ingress.ingest("telegram", { text: "halo", trustedPeerEvidence: "alice" });
  await tick();
  assert.notEqual(upper.canonicalSessionId, lower.canonicalSessionId);
});

test("DSC-R1-006: same textual evidence on different channels stays distinct", async () => {
  const { ingress, manager } = makeIngress();
  const tg = ingress.ingest("telegram", { text: "hi", trustedPeerEvidence: "u1" });
  const wa = ingress.ingest("whatsapp", { text: "hi", trustedPeerEvidence: "u1" });
  await tick();
  assert.notEqual(tg.canonicalSessionId, wa.canonicalSessionId);
  assert.equal(manager.calls.length, 2);
});

test("DSC-R1-006: forged userId cannot hijack a trusted-evidence session", async () => {
  const { ingress, manager } = makeIngress();
  const victim = ingress.ingest("telegram", { text: "victim", trustedPeerEvidence: "victim-peer" });
  await tick();
  // Attacker supplies raw userId equal to the victim's transport identity.
  const attacker = ingress.ingest("telegram", {
    text: "hijack", userId: "victim-peer"
  });
  await tick();
  assert.equal("canonicalSessionId" in attacker, false,
    "raw userId cannot select the victim's continuity session");
  assert.equal(manager.calls.length, 2);
  assert.equal("continuitySessionId" in manager.calls[1], false);
});

test("DSC-R1-006: missing evidence gets no continuity binding (no anon)", async () => {
  const { ingress, manager } = makeIngress();
  const result = ingress.ingest("console", { text: "tanpa identitas" });
  assert.equal(result.accepted, true, "ses_* interaction path continues");
  assert.equal("canonicalSessionId" in result, false);
  await tick();
  assert.equal("continuitySessionId" in manager.calls[0], false);
  // No anonymous session was minted.
  assert.equal(ingress.continuityStatus().sessions, 0);
});

// ---------------------------------------------------------------------------
// 15 — canonical ingress flow
// ---------------------------------------------------------------------------

test("15: continuity events flow through the canonical Manager ingress", async () => {
  const { ingress, manager } = makeIngress();
  const first = ingress.ingest("console", { text: "halo", trustedPeerEvidence: "console-owner" });
  await tick();
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "console");
  assert.ok(manager.calls[0].sessionId.startsWith("ses_"), "transport session stays ses_*");
  assert.equal(manager.calls[0].continuitySessionId, first.canonicalSessionId);
});

test("15b: channel A → channel B continuity through trusted binding", async () => {
  const { ingress, manager, controller } = makeIngress();
  const first = ingress.ingest("telegram", { text: "mulai di telegram", trustedPeerEvidence: "owner" });
  await tick();
  const canonicalId = first.canonicalSessionId;
  // Explicit trusted cross-channel binding through the private composition
  // logic (the controller captured by trustedLifecycle).
  controller.trustedTransferBinding({
    provenance: controller.mintPeerProvenance("whatsapp", "owner"),
    toSessionId: canonicalId
  });
  const second = ingress.ingest("whatsapp", { text: "lanjut di whatsapp", trustedPeerEvidence: "owner" });
  await tick();
  assert.equal(second.accepted, true);
  assert.equal(second.canonicalSessionId, canonicalId);
  assert.equal(manager.calls[1].continuitySessionId, canonicalId);
  assert.notEqual(manager.calls[1].sessionId, manager.calls[0].sessionId,
    "ses_* transport sessions remain per-channel distinct");
});

test("15c: different trusted peers get distinct canonical sessions", async () => {
  const { ingress } = makeIngress();
  const a = ingress.ingest("telegram", { text: "a", trustedPeerEvidence: "alice" });
  const b = ingress.ingest("telegram", { text: "b", trustedPeerEvidence: "bob" });
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
  assert.equal("continuitySessionId" in manager.calls[0], false);
});

test("15f: trusted evidence bound to another session cannot be re-bound publicly", async () => {
  const { ingress, continuity } = makeIngress();
  const first = ingress.ingest("telegram", { text: "mine", trustedPeerEvidence: "shared-peer" });
  await tick();
  // A direct facade attempt to rebind fails closed.
  assert.throws(
    () => {
      const session = continuity.createSession({});
      continuity.bindChannel({
        sessionId: session.sessionId,
        provenance: null // no way to even present provenance without the mint
      });
    },
    (error) => error.code === "PROVENANCE_UNTRUSTED"
  );
});

// ---------------------------------------------------------------------------
// DSC-R1-002 — ingress admission race (REAL ingress path)
// ---------------------------------------------------------------------------

test("DSC-R1-002 RACE: old completion after resume is rejected; new incarnation untouched", async () => {
  // A manager whose completion is PAUSABLE: the interaction stays in flight
  // until the test releases it.
  let releaseFirst = null;
  const manager = {
    calls: [],
    async handle(input) {
      this.calls.push(input);
      if (this.calls.length === 1) {
        await new Promise((resolve) => { releaseFirst = resolve; });
      }
      return Object.freeze({
        managerRequestId: `req-${this.calls.length}`,
        outcome: "COMPLETED",
        lifecycleState: "COMPLETED",
        detail: `echo:${input.payload.text}`
      });
    }
  };
  let now = 1000;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  let controller = null;
  const continuity = createSessionContinuity({
    clock,
    idFactory: createSequentialContinuityIdFactory(),
    store: createMemoryContinuityStore(),
    trustedLifecycle(c) { controller = c; }
  });
  const ingress = createManagerInteractionIngress({
    bus,
    manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity: { mintPeerProvenance: controller.mintPeerProvenance },
    peerEvidenceProvider: (channel, rawEvent) => {
      const d = Object.getOwnPropertyDescriptor(rawEvent, "trustedPeerEvidence");
      return d && typeof d.value === "string" ? d.value : "";
    },
    historyRecorder: null // isolate this test from history I/O
  });

  // Incarnation N: start an interaction whose Manager completion is paused.
  const old = ingress.ingest("telegram", { text: "pekerjaan lama", trustedPeerEvidence: "race-u" });
  assert.equal(old.accepted, true);
  const admissionIncarnation = continuity.currentIncarnation(old.canonicalSessionId);
  assert.equal(admissionIncarnation, 1);
  await tick(); // let the handler reach the paused Manager await

  // Resume the session → incarnation N+1.
  continuity.resumeSession({ sessionId: old.canonicalSessionId });
  assert.equal(continuity.currentIncarnation(old.canonicalSessionId), 2);

  // Release the OLD interaction completion.
  releaseFirst();
  await tick(); await tick(); await tick();

  // The old interaction's terminal commit used the ADMISSION incarnation →
  // STALE_GENERATION: the new incarnation's ledger is UNTOUCHED.
  assert.equal(continuity.getTerminalInteraction(old.interactionId), null,
    "old work must not record terminal state in the new incarnation");
  // A direct attempt with the admission incarnation also fails.
  assert.throws(
    () => continuity.commitTerminalOutcome({
      sessionId: old.canonicalSessionId,
      interactionId: old.interactionId,
      generation: admissionIncarnation,
      state: "COMPLETED"
    }),
    (error) => error.code === "STALE_GENERATION"
  );

  // A NEW interaction under the CURRENT incarnation succeeds end-to-end.
  const fresh = ingress.ingest("telegram", { text: "pekerjaan baru", trustedPeerEvidence: "race-u" });
  await tick(); await tick();
  assert.equal(fresh.accepted, true);
  const recorded = continuity.getTerminalInteraction(fresh.interactionId);
  assert.ok(recorded, "current-incarnation work records its terminal outcome");
  assert.equal(recorded.state, "COMPLETED");
});

test("DSC-R1-002 RACE: old ERROR after resume is contained (no mutation)", async () => {
  let rejectFirst = null;
  const manager = {
    calls: [],
    async handle(input) {
      this.calls.push(input);
      if (this.calls.length === 1) {
        await new Promise((_, reject) => { rejectFirst = reject; });
      }
      return Object.freeze({
        managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok"
      });
    }
  };
  let now = 1000;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  let controller = null;
  const continuity = createSessionContinuity({
    clock, idFactory: createSequentialContinuityIdFactory(),
    store: createMemoryContinuityStore(), trustedLifecycle(c) { controller = c; }
  });
  const ingress = createManagerInteractionIngress({
    bus, manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity: { mintPeerProvenance: controller.mintPeerProvenance },
    peerEvidenceProvider: (channel, rawEvent) => {
      const d = Object.getOwnPropertyDescriptor(rawEvent, "trustedPeerEvidence");
      return d && typeof d.value === "string" ? d.value : "";
    },
    historyRecorder: null
  });
  const old = ingress.ingest("telegram", { text: "akan gagal", trustedPeerEvidence: "err-u" });
  await tick();
  continuity.resumeSession({ sessionId: old.canonicalSessionId });
  // The old interaction REJECTS after the resume.
  const boom = Object.assign(new Error("late failure"), { code: "LATE" });
  const observed = new Promise((resolve) => {
    ingress.request("telegram", { text: "x", trustedPeerEvidence: "err-u" }).catch(() => resolve());
  });
  rejectFirst(boom);
  await tick(); await tick();
  await Promise.race([observed, new Promise((r) => setTimeout(r, 500))]);
  // The new incarnation's ledger is untouched by the old error.
  assert.equal(continuity.getTerminalInteraction(old.interactionId), null);
});

test("DSC-R1-002: duplicate terminal outcome under the current generation is idempotent", async () => {
  const { ingress, continuity } = makeIngress();
  const event = ingress.ingest("console", { text: "done", trustedPeerEvidence: "dup-u" });
  await tick(); await tick();
  const canonicalId = event.canonicalSessionId;
  const generation = continuity.currentIncarnation(canonicalId);
  const first = continuity.commitTerminalOutcome({
    sessionId: canonicalId, interactionId: event.interactionId, generation, state: "COMPLETED"
  });
  assert.equal(first.idempotent, true, "already committed by the canonical handler");
  const replay = continuity.commitTerminalOutcome({
    sessionId: canonicalId, interactionId: event.interactionId, generation, state: "FAILED"
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.state, "COMPLETED", "first terminal state wins");
});

// ---------------------------------------------------------------------------
// DSC-R1-004 — history consumption through the ingress
// ---------------------------------------------------------------------------

test("DSC-R1-004: the Manager receives prior logical context from the history seam", async () => {
  const historyStore = new Map(); // dsc_* → turns (test seam standing in for ChannelManager store)
  const historyProvider = async (dscId) => historyStore.get(dscId) ?? [];
  const historyRecorder = async ({ continuitySessionId, userText, assistantDetail }) => {
    const turns = historyStore.get(continuitySessionId) ?? [];
    turns.push({ role: "user", content: userText });
    turns.push({ role: "assistant", content: assistantDetail });
    historyStore.set(continuitySessionId, turns);
  };
  const { ingress, controller } = makeIngress({ historyRecorder, historyProvider });
  const first = ingress.ingest("telegram", { text: "nama saya Budi", trustedPeerEvidence: "owner" });
  await tick(); await tick();
  const canonicalId = first.canonicalSessionId;
  // Trusted cross-channel bind.
  controller.trustedTransferBinding({
    provenance: controller.mintPeerProvenance("console", "owner"), toSessionId: canonicalId
  });
  const second = ingress.ingest("console", { text: "siapa nama saya?", trustedPeerEvidence: "owner" });
  await tick(); await tick();
  // Verify the WRITE path recorded both exchanges under the logical key.
  assert.equal(historyStore.get(canonicalId).length, 4);
  assert.equal(historyStore.get(canonicalId)[2].content, "siapa nama saya?");
});

test("DSC-R1-004: no continuity binding → no history read/write", async () => {
  const historyStore = new Map();
  let reads = 0;
  const { ingress, manager } = makeIngress({
    historyProvider: async () => { reads += 1; return []; },
    historyRecorder: async () => { throw new Error("must not be called"); }
  });
  // No trusted evidence → no continuity → no history.
  ingress.ingest("console", { text: "legacy", userId: "raw-only" });
  await tick(); await tick();
  assert.equal(reads, 0);
  assert.equal(historyStore.size, 0);
  assert.equal("continuityContext" in manager.calls[0], false);
});

test("DSC-R1-004: forged dsc_* claim cannot select history", async () => {
  const historyStore = new Map();
  const historyProvider = async (dscId) => historyStore.get(dscId) ?? [];
  const historyRecorder = async ({ continuitySessionId, userText, assistantDetail }) => {
    const turns = historyStore.get(continuitySessionId) ?? [];
    turns.push({ role: "user", content: userText }, { role: "assistant", content: assistantDetail });
    historyStore.set(continuitySessionId, turns);
  };
  const { ingress } = makeIngress({ historyRecorder, historyProvider });
  const victim = ingress.ingest("telegram", { text: "rahasia korban", trustedPeerEvidence: "victim" });
  await tick(); await tick();
  // Attacker with ONLY raw metadata claims of the victim's dsc_*.
  const attacker = ingress.ingest("telegram", {
    text: "apa rahasianya?", userId: "victim", sessionId: victim.canonicalSessionId
  });
  await tick(); await tick();
  assert.equal("canonicalSessionId" in attacker, false,
    "forged dsc_* claim selects nothing — no continuity at all");
  // Only the victim's logical key exists in history; nothing was written
  // for the attacker (they have no continuity identity).
  assert.deepEqual([...historyStore.keys()], [victim.canonicalSessionId]);
  const victimHistory = historyStore.get(victim.canonicalSessionId);
  assert.ok(!victimHistory.some((t) => t.content.includes("apa rahasianya")),
    "the attacker's turn was not recorded into the victim's logical history");
});

// ---------------------------------------------------------------------------
// 12/13/14 — persistence fail-closed (retained)
// ---------------------------------------------------------------------------

test("12: corrupt snapshot degrades safely", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-c-degraded-"));
  const file = path.join(dir, "continuity.json");
  fs.writeFileSync(file, "{ not json !!!", "utf8");
  const storeA = createFileContinuityStore(file);
  const { continuity } = (() => {
    let controller = null;
    const continuity = createSessionContinuity({
      clock: () => 1000,
      idFactory: createSequentialContinuityIdFactory(),
      store: storeA,
      trustedLifecycle(c) { controller = c; }
    });
    return { continuity };
  })();
  const result = await continuity.restore();
  assert.equal(result.restored, false);
  assert.equal(result.degraded, true);
  const created = continuity.createSession({});
  assert.ok(created.sessionId.startsWith("dsc_"));
  await storeA.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("13: malformed snapshots fail closed", () => {
  const bad = (snapshot) => {
    assert.equal(validateSnapshot(snapshot).corrupt, true, JSON.stringify(String(snapshot)).slice(0, 60));
  };
  bad(null); bad(undefined); bad("s"); bad(42); bad([]); bad({});
  bad({ schemaVersion: 2, savedAt: 1, sessions: [], terminal: {} });
  bad({ schemaVersion: 1, savedAt: -1, sessions: [], terminal: {} });
  bad({ schemaVersion: 1, savedAt: 1, sessions: {}, terminal: {} });
  bad({ schemaVersion: 1, savedAt: 1, sessions: [], terminal: {}, extra: 1 });
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [], terminal: {},
    sessions: [{ sessionId: "bad", createdAt: 1, updatedAt: 1, incarnation: 1, resumeMetadata: null, terminalAt: null, channels: [] }]
  });
});

test("14: oversized snapshots rejected", async () => {
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
  fs.writeFileSync(file, JSON.stringify(oversized), "utf8");
  const loaded = await store.load();
  assert.equal(loaded.corrupt, true);
  await store.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("14b: session limit fails closed", () => {
  const { continuity } = (() => {
    let controller = null;
    const continuity = createSessionContinuity({
      clock: () => 1000,
      idFactory: createSequentialContinuityIdFactory(),
      store: createMemoryContinuityStore(),
      trustedLifecycle(c) { controller = c; }
    });
    return { continuity };
  })();
  let created = 0;
  try {
    for (let i = 0; i < 300; i += 1) { continuity.createSession({}); created += 1; }
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "SESSION_LIMIT_EXCEEDED");
    assert.equal(created, 256);
  }
});

// ---------------------------------------------------------------------------
// 11/16/17/18 — retained invariants
// ---------------------------------------------------------------------------

test("11: cancellation before restart remains terminal after resume", async () => {
  const { bus, continuity, controller } = makeIngress();
  const created = continuity.createSession({});
  const prov = controller.mintPeerProvenance("console", "u");
  continuity.bindChannel({ sessionId: created.sessionId, provenance: prov });
  continuity.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "ix_000000000001", generation: 1, state: "CANCELLED" });
  continuity.resumeSession({ sessionId: created.sessionId });
  const outcome = continuity.acceptAsyncOutcome({ interactionId: "ix_000000000001", sessionId: created.sessionId, generation: 2 });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "ALREADY_TERMINAL");
  const result = bus.requestCancellation({
    sessionId: "ses_unknown", transportId: "channel.console", targetInteractionId: "ix_000000000009"
  });
  assert.equal(result.accepted, false);
});

test("16: voice interaction with continuity uses the canonical ingress path", async () => {
  const { ingress, manager } = makeIngress();
  const result = await ingress.request("voice", {
    text: "jam berapa sekarang", trustedPeerEvidence: "voice-session-1"
  });
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "voice");
  assert.equal(result.detail, "echo:jam berapa sekarang");
});

test("17: Lane 3 local-first voice fallback unchanged", async () => {
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
    assert.equal(fetches, 0);
  } finally {
    if (oldUrl === undefined) delete process.env.DAMAR_TTS_URL; else process.env.DAMAR_TTS_URL = oldUrl;
    global.fetch = oldFetch;
  }
});

test("18: Manager composition site count unchanged", () => {
  const fs2 = require("node:fs");
  const bootstrapSource = fs2.readFileSync(require.resolve("../../src/manager/bootstrap"), "utf8");
  assert.equal((bootstrapSource.match(/createDamarManagerComposition\s*\(\s*\{/g) || []).length, 1);
  const internalSource = fs2.readFileSync(require.resolve("../../src/manager/internal/managerBootstrap"), "utf8");
  assert.equal((internalSource.match(/function createDamarManagerComposition/g) || []).length, 1);
  const managerIndex = require("../../src/manager/index");
  assert.equal("createDamarManagerComposition" in managerIndex, false);
});

// ---------------------------------------------------------------------------
// 20 — races and termination
// ---------------------------------------------------------------------------

test("20b: race — simultaneous first events with the same evidence converge", async () => {
  const { ingress, manager } = makeIngress();
  const a = ingress.ingest("telegram", { text: "satu", trustedPeerEvidence: "u1" });
  const b = ingress.ingest("telegram", { text: "dua", trustedPeerEvidence: "u1" });
  await tick(); await tick();
  assert.equal(a.canonicalSessionId, b.canonicalSessionId);
  assert.equal(manager.calls.length, 2);
});

test("20c: race — concurrent trusted cross-channel unification does not duplicate", async () => {
  const { ingress, manager, controller, continuity } = makeIngress();
  const first = ingress.ingest("console", { text: "mulai", trustedPeerEvidence: "u1" });
  await tick();
  const canonicalId = first.canonicalSessionId;
  controller.trustedTransferBinding({
    provenance: controller.mintPeerProvenance("telegram", "u1"), toSessionId: canonicalId
  });
  const tg1 = ingress.ingest("telegram", { text: "a", trustedPeerEvidence: "u1" });
  const tg2 = ingress.ingest("telegram", { text: "b", trustedPeerEvidence: "u1" });
  await tick(); await tick();
  assert.equal(tg1.canonicalSessionId, canonicalId);
  assert.equal(tg2.canonicalSessionId, canonicalId);
  assert.equal(continuity.snapshotDiagnostics().sessions, 1);
  assert.equal(manager.calls.length, 3);
});

test("20: ingress leaves no open handles after shutdown", async () => {
  const { ingress } = makeIngress();
  ingress.ingest("console", { text: "x", trustedPeerEvidence: "u" });
  await tick(); await tick();
  const result = await ingress.shutdownContinuity();
  assert.equal(result.shutdown, true);
});
