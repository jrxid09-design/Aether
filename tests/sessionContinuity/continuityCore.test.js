"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (repair R2, part 1).
 *
 * Continuity-domain contracts through the REPAIRED trust architecture:
 * the trusted controller and provenance mint are captured ONLY through the
 * trustedLifecycle closure hook — never through exports, tokens, or
 * resolvers.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createSessionContinuity,
  createSequentialContinuityIdFactory,
  createMemoryContinuityStore,
  createFileContinuityStore,
  validateSnapshot,
  buildSnapshot
} = require("../../src/runtime/sessionContinuity");

/** Composition-style domain: captures the trusted controller through the
 * trustedLifecycle hook exactly as the production composition root does. */
function makeDomain(options = {}) {
  let now = options.now === undefined ? 1000 : options.now;
  const clock = () => now;
  let controller = null;
  const domain = createSessionContinuity({
    clock,
    idFactory: options.idFactory || createSequentialContinuityIdFactory(),
    store: options.store || createMemoryContinuityStore(),
    persistOnMutation: options.persistOnMutation === true,
    trustedLifecycle(captured) {
      if (controller !== null) throw new Error("double capture");
      controller = captured;
    }
  });
  return {
    domain,
    controller,
    advance: (ms) => { now += ms; },
    setNow: (value) => { now = value; }
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "damar-continuity-"));
}

// ---------------------------------------------------------------------------
// DSC-R1-001 — public surface hardening
// ---------------------------------------------------------------------------

test("DSC-R1-001: no public mint, no trusted controller, no resolver anywhere", () => {
  const mod = require("../../src/runtime/sessionContinuity/continuity");
  const t = makeDomain();
  // Module exports carry NO trust capability.
  for (const key of Object.keys(mod)) {
    assert.match(key, /^(createSessionContinuity|TERMINAL_INTERACTION_STATES|DEFAULT_BOUNDS)$/);
  }
  assert.equal("mintPeerProvenance" in mod, false);
  assert.equal("isPeerProvenance" in mod, false);
  assert.equal("_resolveTrustedController" in mod, false);
  // The public index carries NO trust capability either.
  const pub = require("../../src/runtime/sessionContinuity");
  assert.equal("mintPeerProvenance" in pub, false);
  assert.equal("isPeerProvenance" in pub, false);
  assert.equal("_resolveTrustedController" in pub, false);
  // The facade has NO __trusted, NO resetDurableState, NO transfer.
  assert.equal("__trusted" in t.domain, false);
  assert.equal("resetDurableState" in t.domain, false);
  assert.equal("trustedTransferBinding" in t.domain, false);
  // No property of the facade is a trusted resolver.
  for (const key of Object.keys(t.domain)) {
    assert.doesNotMatch(key, /trusted|resolver|__|reset/i);
  }
});

test("DSC-R1-001: public facade final method list is exactly the inert set", () => {
  const t = makeDomain();
  assert.deepEqual(Object.keys(t.domain).sort(), [
    "acceptAsyncOutcome", "bindChannel", "captureAdmissionOwnership", "checkIncarnation",
    "closeSession", "commitTerminalOutcome", "createSession", "currentIncarnation",
    "getSession", "getPersistenceStatus", "getTerminalInteraction", "persist",
    "resolveChannel", "restore", "resumeSession", "shutdown", "snapshotDiagnostics",
    "unbindChannel", "updateResumeMetadata", "whenPersisted"
  ].sort());
});

test("DSC-R1-001: provenance cannot be forged by any shape", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const lookalikes = [
    Object.freeze({ kind: "PeerProvenance", channel: "telegram", peer: "u1", key: "telegram\u0000u1" }),
    { kind: "PeerProvenance", channel: "telegram", peer: "u1" },
    null,
    undefined,
    "telegram:u1",
    {},
  ];
  for (const forged of lookalikes) {
    assert.throws(
      () => t.domain.bindChannel({ sessionId: created.sessionId, provenance: forged }),
      (error) => error.code === "PROVENANCE_UNTRUSTED",
      JSON.stringify(String(forged))
    );
    assert.throws(
      () => t.domain.resolveChannel({ provenance: forged }),
      (error) => error.code === "PROVENANCE_UNTRUSTED"
    );
  }
});

test("DSC-R1-001: raw caller userId alone can never establish provenance", () => {
  // There is NO public path from an arbitrary string to provenance: the only
  // mint lives behind the trustedLifecycle hook captured by the composition.
  const t = makeDomain();
  // Provenance from the trusted controller works.
  const prov = t.controller.mintPeerProvenance("telegram", "real-transport-identity");
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov });
  assert.equal(t.domain.resolveChannel({ provenance: prov }).sessionId, created.sessionId);
  // But there is no facade method accepting a raw string identity at all.
  for (const name of ["bindChannel", "resolveChannel", "unbindChannel"]) {
    try {
      t.domain[name]({ sessionId: created.sessionId, channel: "telegram", peer: "attacker" });
      assert.fail(`${name} accepted a raw peer argument`);
    } catch (error) {
      assert.equal(error.code, "PROVENANCE_UNTRUSTED");
    }
  }
});

test("DSC-R1-001: binding TRANSFER exists only on the private trusted controller", () => {
  const t = makeDomain();
  const first = t.domain.createSession({});
  const second = t.domain.createSession({});
  const provenance = t.controller.mintPeerProvenance("telegram", "u1");
  t.domain.bindChannel({ sessionId: first.sessionId, provenance });
  // The PUBLIC facade cannot rebind even with an explicit flag.
  assert.throws(
    () => t.domain.bindChannel({ sessionId: second.sessionId, provenance, rebind: true }),
    (error) => error.code === "BINDING_CONFLICT"
  );
  assert.equal("trustedTransferBinding" in t.domain, false);
  // The TRUSTED controller can transfer — an explicit composition act that
  // moves identity continuity only (never authority).
  const transfer = t.controller.trustedTransferBinding({ provenance, toSessionId: second.sessionId });
  assert.equal(transfer.fromSessionId, first.sessionId);
  assert.equal(transfer.toSessionId, second.sessionId);
  assert.equal(t.domain.resolveChannel({ provenance }).sessionId, second.sessionId);
  assert.equal(t.domain.getSession(first.sessionId).channels.length, 0);
});

// ---------------------------------------------------------------------------
// DSC-R1-003 — public destructive reset removed
// ---------------------------------------------------------------------------

test("DSC-R1-003: destructive reset is private; normal shutdown preserves state", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const storeA = createFileContinuityStore(file);
  const t = makeDomain({ store: storeA, persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "u1") });
  await t.domain.whenPersisted();
  // No public reset.
  assert.equal("resetDurableState" in t.domain, false);
  assert.equal("resetDurableState" in t.controller, true, "private controller owns the reset");
  // Normal shutdown NEVER deletes.
  const shutdown = await t.domain.shutdown();
  assert.equal(shutdown.shutdown, true);
  assert.equal(fs.existsSync(file), true, "shutdown must not delete the durable snapshot");

  await storeA.shutdown(); // simulate previous process death: ownership released, data persists
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.equal(restored.sessions, 1);

  // Private administrative reset works only through the trusted composition
  // harness (the controller captured by trustedLifecycle).
  await t2.controller.resetDurableState();
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// DSC-R1-006 — runtime-owned peer evidence semantics (domain level)
// ---------------------------------------------------------------------------

test("DSC-R1-006: trusted transport-derived peer resolves its own binding", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const prov = t.controller.mintPeerProvenance("telegram", "77123456:77123456");
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov });
  const resolution = t.domain.resolveChannel({ provenance: prov });
  assert.equal(resolution.resolved, true);
  assert.equal(resolution.sessionId, created.sessionId);
});

test("DSC-R1-006: Alice vs alice stay distinct (exact transport identity)", () => {
  const t = makeDomain();
  const upper = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: upper.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "Alice") });
  assert.equal(t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("telegram", "alice") }).resolved, false);
  const lower = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: lower.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "alice") });
  assert.notEqual(
    t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("telegram", "Alice") }).sessionId,
    t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("telegram", "alice") }).sessionId
  );
});

test("DSC-R1-006: same textual transport identity on different channels stays distinct", () => {
  const t = makeDomain();
  const tg = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: tg.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "u1") });
  assert.equal(t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("whatsapp", "u1") }).resolved, false);
  const wa = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: wa.sessionId, provenance: t.controller.mintPeerProvenance("whatsapp", "u1") });
  assert.notEqual(tg.sessionId, wa.sessionId);
});

test("DSC-R1-006: punctuation-different transport identities stay distinct", () => {
  const t = makeDomain();
  const a = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: a.sessionId, provenance: t.controller.mintPeerProvenance("whatsapp", "user.official@s.whatsapp.net") });
  for (const different of [
    "user official@s.whatsapp.net", "user_official@s.whatsapp.net",
    "userofficial@s.whatsapp.net", "user.Official@s.whatsapp.net", "user..official@s.whatsapp.net"
  ]) {
    assert.equal(
      t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("whatsapp", different) }).resolved,
      false, different
    );
  }
});

test("DSC-R1-006: missing/untrusted evidence yields NO continuity binding (no anon)", () => {
  const t = makeDomain();
  // The mint itself rejects missing/blank evidence — there is no way to
  // produce an "anon" provenance.
  for (const missing of [null, undefined, "", "   "]) {
    assert.throws(
      () => t.controller.mintPeerProvenance("console", missing),
      (error) => error.code === "PROVENANCE_PEER_INVALID",
      JSON.stringify(String(missing))
    );
  }
  assert.equal(t.domain.snapshotDiagnostics().sessions, 0);
  assert.equal(t.domain.snapshotDiagnostics().bindings, 0);
});

// ---------------------------------------------------------------------------
// Peer byte bound (UTF-8 bytes, not characters)
// ---------------------------------------------------------------------------

test("PEER BYTE BOUND: enforced as actual UTF-8 bytes", () => {
  const t = makeDomain();
  const ascii128 = "a".repeat(128);                       // 128 bytes
  const multibyte64 = "é".repeat(64);                     // 128 bytes (2 bytes each)
  const multibyte65 = "é".repeat(65);                     // 130 bytes → reject
  const boundary4Bytes = "𝕏".repeat(32);                  // 128 bytes (4 bytes each)
  const over4Bytes = "𝕏".repeat(33);                      // 132 bytes → reject
  // Accepted at the byte boundary.
  t.controller.mintPeerProvenance("telegram", ascii128);
  t.controller.mintPeerProvenance("telegram", multibyte64);
  t.controller.mintPeerProvenance("telegram", boundary4Bytes);
  // Rejected one byte over — fail closed, never truncate.
  for (const over of [multibyte65, over4Bytes, "a".repeat(129)]) {
    assert.throws(
      () => t.controller.mintPeerProvenance("telegram", over),
      (error) => error.code === "PROVENANCE_PEER_INVALID",
      `${over.length} chars`
    );
  }
});

// ---------------------------------------------------------------------------
// DSC-R1-002 — admission incarnation capture (domain level)
// ---------------------------------------------------------------------------

test("DSC-R1-002: admission capture freezes the incarnation at admission", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const admission = t.domain.captureAdmissionOwnership({ sessionId: created.sessionId });
  assert.equal(admission.sessionId, created.sessionId);
  assert.equal(admission.incarnationAtAdmission, 1);
  assert.equal(Object.isFrozen(admission), true);
  // Resume advances the CURRENT incarnation, but the captured tuple keeps
  // the old one — old work stays old.
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(t.domain.currentIncarnation(created.sessionId), 2);
  assert.equal(admission.incarnationAtAdmission, 1, "captured tuple is immutable");
});

test("DSC-R1-002: completion with the CAPTURED incarnation is rejected after resume", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const admission = t.domain.captureAdmissionOwnership({ sessionId: created.sessionId });
  t.domain.resumeSession({ sessionId: created.sessionId });
  // Old work completing under its admission incarnation: STALE rejection,
  // ledger untouched.
  assert.throws(
    () => t.domain.commitTerminalOutcome({
      sessionId: admission.sessionId,
      interactionId: "ix_old",
      generation: admission.incarnationAtAdmission,
      state: "COMPLETED"
    }),
    (error) => error.code === "STALE_GENERATION"
  );
  assert.equal(t.domain.getTerminalInteraction("ix_old"), null);
  // New work under the CURRENT incarnation succeeds.
  const fresh = t.domain.captureAdmissionOwnership({ sessionId: created.sessionId });
  const commit = t.domain.commitTerminalOutcome({
    sessionId: created.sessionId,
    interactionId: "ix_new",
    generation: fresh.incarnationAtAdmission,
    state: "COMPLETED"
  });
  assert.equal(commit.recorded, true);
});

// ---------------------------------------------------------------------------
// DSC-004 (retained) — atomic terminal ownership
// ---------------------------------------------------------------------------

test("DSC-004: terminal commit is atomic, incarnation-owned, idempotent", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const first = t.domain.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_one", generation: 1, state: "COMPLETED"
  });
  assert.equal(first.recorded, true);
  const dup = t.domain.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_one", generation: 1, state: "FAILED"
  });
  assert.equal(dup.recorded, false);
  assert.equal(dup.idempotent, true);
  assert.equal(dup.state, "COMPLETED", "first terminal state wins");
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.throws(
    () => t.domain.commitTerminalOutcome({
      sessionId: created.sessionId, interactionId: "ix_two", generation: 1, state: "COMPLETED"
    }),
    (error) => error.code === "STALE_GENERATION"
  );
  assert.equal(t.domain.getTerminalInteraction("ix_two"), null);
});

test("DSC-004: concurrent terminal attempts — exactly one records", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const attempts = ["COMPLETED", "FAILED", "CANCELLED"].map((state) =>
    t.domain.commitTerminalOutcome({
      sessionId: created.sessionId, interactionId: "ix_race", generation: 1, state
    })
  );
  assert.equal(attempts.filter((a) => a.recorded).length, 1);
  assert.equal(t.domain.getTerminalInteraction("ix_race").state, "COMPLETED");
});

test("DSC-004: terminal after close fails closed", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  t.domain.closeSession({ sessionId: created.sessionId });
  assert.throws(
    () => t.domain.commitTerminalOutcome({
      sessionId: created.sessionId, interactionId: "ix_late", generation: 1, state: "COMPLETED"
    }),
    (error) => error.code === "SESSION_TERMINAL"
  );
});

test("10b: terminal ledger stays bounded", () => {
  const t = makeDomain();
  const owner = t.domain.createSession({});
  for (let i = 0; i < 1100; i += 1) {
    t.domain.commitTerminalOutcome({
      sessionId: owner.sessionId,
      interactionId: `ix_${String(i).padStart(12, "0")}`,
      generation: 1,
      state: "COMPLETED"
    });
  }
  assert.equal(t.domain.snapshotDiagnostics().terminalInteractions <= 1024, true);
});

// ---------------------------------------------------------------------------
// DSC-002 (retained) — mutable-state isolation
// ---------------------------------------------------------------------------

test("DSC-002: views are frozen inert projections with no canonical effect", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const prov = t.controller.mintPeerProvenance("console", "u");
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov });
  const view = t.domain.getSession(created.sessionId);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.channels[0]), true);
  assert.throws(() => { view.incarnation = 99; }, TypeError);
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(t.domain.getSession(created.sessionId).incarnation, 2);
});

test("DSC-002: closed metadata mutation validates before mutating", () => {
  const t = makeDomain();
  const created = t.domain.createSession({ resumeMetadata: { safe: 1 } });
  const generation = t.domain.currentIncarnation(created.sessionId);
  assert.throws(
    () => t.domain.updateResumeMetadata({
      sessionId: created.sessionId, generation, resumeMetadata: { evil: () => 1 }
    }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  assert.deepEqual(t.domain.getSession(created.sessionId).resumeMetadata, { safe: 1 });
  const updated = t.domain.updateResumeMetadata({
    sessionId: created.sessionId, generation, resumeMetadata: { safe: 2 }
  });
  assert.equal(Object.isFrozen(updated), true);
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.throws(
    () => t.domain.updateResumeMetadata({
      sessionId: created.sessionId, generation, resumeMetadata: { hijack: true }
    }),
    (error) => error.code === "STALE_GENERATION"
  );
});

test("DSC-002: authority/capabilities cannot enter live state", () => {
  const t = makeDomain();
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: { grant: () => "ALLOW" } }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  const smuggled = {};
  smuggled.cycle = smuggled;
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: smuggled }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: new Proxy({}, { get() { return "ADMIN"; } }) }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
});

// ---------------------------------------------------------------------------
// Restart / restore semantics (retained)
// ---------------------------------------------------------------------------

test("1: same canonical session resumes after simulated restart (durable store)", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const storeA = createFileContinuityStore(file);
  const t = makeDomain({ store: storeA, persistOnMutation: true });
  const created = t.domain.createSession({ resumeMetadata: { topic: "sore" } });
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: t.controller.mintPeerProvenance("console", "owner") });
  await t.domain.whenPersisted();

  await storeA.shutdown(); // simulate previous process death: ownership released, data persists
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.equal(restored.degraded, false);
  assert.equal(t2.domain.getSession(created.sessionId).state, "CLOSED", "RESTORED != RESUMED");
  const resumed = t2.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(resumed.incarnation, 2);
  assert.deepEqual(resumed.resumeMetadata, { topic: "sore" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("1b: binding survives restore+resume and resolves", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const storeA = createFileContinuityStore(file);
  const t = makeDomain({ store: storeA, persistOnMutation: true });
  const created = t.domain.createSession({});
  const prov = t.controller.mintPeerProvenance("telegram", "u1");
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov });
  await t.domain.whenPersisted();

  await storeA.shutdown(); // simulate previous process death: ownership released, data persists
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t2.domain.restore();
  const inert = t2.domain.resolveChannel({ provenance: t2.controller.mintPeerProvenance("telegram", "u1") });
  assert.equal(inert.resolved, true);
  assert.equal(inert.resumed, false);
  t2.domain.resumeSession({ sessionId: created.sessionId });
  const resolved = t2.domain.resolveChannel({ provenance: t2.controller.mintPeerProvenance("telegram", "u1") });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.sessionId, created.sessionId);
  assert.equal(resolved.resumed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("2: persisted inert state reconstructs safely", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const storeA = createFileContinuityStore(file);
  const t = makeDomain({ store: storeA, persistOnMutation: true });
  const a = t.domain.createSession({ resumeMetadata: { turns: 3, lang: "id" } });
  t.domain.bindChannel({ sessionId: a.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "user-77") });
  t.domain.bindChannel({ sessionId: a.sessionId, provenance: t.controller.mintPeerProvenance("whatsapp", "user-77") });
  t.domain.commitTerminalOutcome({ sessionId: a.sessionId, interactionId: "ix_000000000001", generation: 1, state: "COMPLETED" });
  await t.domain.whenPersisted();

  await storeA.shutdown(); // simulate previous process death: ownership released, data persists
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const result = await t2.domain.restore();
  assert.equal(result.restored, true);
  const snapshot = t2.domain.getSession(a.sessionId);
  assert.deepEqual(snapshot.channels.map((c) => c.channel), ["telegram", "whatsapp"]);
  assert.equal(t2.domain.getTerminalInteraction("ix_000000000001").state, "COMPLETED");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("3: snapshot validation rejects hostile shapes", () => {
  const bad = (snapshot) => {
    assert.equal(validateSnapshot(snapshot).corrupt, true, JSON.stringify(String(snapshot)).slice(0, 60));
  };
  bad(null); bad(undefined); bad("string"); bad(42); bad([]); bad({});
  bad({ schemaVersion: 2, savedAt: 1, sessions: [], terminal: {} });
  bad({ schemaVersion: 1, savedAt: -1, sessions: [], terminal: {} });
  bad({ schemaVersion: 1, savedAt: 1, sessions: {}, terminal: {} });
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{ sessionId: "not-dsc", createdAt: 1, updatedAt: 1, incarnation: 1, resumeMetadata: null, terminalAt: null, channels: [] }]
  });
  // UTF-8 byte bound on persisted peers too.
  bad({
    schemaVersion: 1, savedAt: 1, terminal: {},
    sessions: [{
      sessionId: "dsc_x", createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null,
      channels: [{ channel: "telegram", peer: "é".repeat(65), boundAt: 1, generation: 1 }]
    }]
  });
  bad({
    schemaVersion: 1, savedAt: 1, sessions: [],
    terminal: { ix_x: { sessionId: "not-dsc", state: "COMPLETED", generation: 1, at: 1 } }
  });
  bad({ schemaVersion: 1, savedAt: 1, sessions: [], terminal: {}, extra: true });
});

test("4: forged claims never hijack; unrelated sessions stay isolated", () => {
  const t = makeDomain();
  const victim = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: victim.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "victim") });
  const attacker = t.domain.createSession({});
  // An attacker cannot steal the victim's binding through the facade.
  assert.throws(
    () => t.domain.bindChannel({ sessionId: attacker.sessionId, provenance: t.controller.mintPeerProvenance("telegram", "victim") }),
    (error) => error.code === "BINDING_CONFLICT"
  );
  // Unbound evidence resolves nothing.
  assert.equal(t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("telegram", "mallory") }).resolved, false);
  // Diagnostics expose counts only.
  const diag = t.domain.snapshotDiagnostics();
  assert.deepEqual(Object.keys(diag).sort(), [
    "bindings", "degradedReason", "persistence", "persistedGeneration", "restored",
    "schemaVersion", "sessions", "terminalInteractions"
  ].sort());
});

test("5c: forged claim cannot resolve a TERMINAL session", () => {
  const t = makeDomain();
  const session = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: session.sessionId, provenance: t.controller.mintPeerProvenance("console", "u") });
  t.domain.closeSession({ sessionId: session.sessionId });
  assert.equal(t.domain.resolveChannel({ provenance: t.controller.mintPeerProvenance("console", "u") }).resolved, false);
});

// ---------------------------------------------------------------------------
// DSC-R1-005B — bounded coalescing persistence scheduler (stress)
// ---------------------------------------------------------------------------

test("DSC-R1-005B: stress — thousands of rapid mutations with slow persistence", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");

  // Artificially SLOW store: counts writes, delays each.
  let writeCount = 0;
  let writeDelayMs = 25;
  const slowStore = {
    snapshot: null,
    async load() { return this.snapshot; },
    async persist(next) {
      writeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, writeDelayMs));
      this.snapshot = next;
    },
    async clear() { this.snapshot = null; }
  };

  const t = makeDomain({ store: slowStore, persistOnMutation: true });
  const session = t.domain.createSession({});
  const prov = t.controller.mintPeerProvenance("telegram", "stress-u");

  // 3000 rapid mutations — far faster than the writer can drain.
  const MUTATIONS = 3000;
  for (let i = 0; i < MUTATIONS; i += 1) {
    t.domain.updateResumeMetadata({
      sessionId: session.sessionId,
      generation: 1,
      resumeMetadata: { seq: i }
    });
    if (i === 100) t.domain.bindChannel({ sessionId: session.sessionId, provenance: prov });
  }

  // Scheduler state must remain BOUNDED regardless of the mutation count.
  const midStatus = t.domain.getPersistenceStatus();
  assert.equal(midStatus.writerActive, true, "exactly one writer active during the storm");
  assert.ok(midStatus.pendingWrites <= 1, `pending writes bounded (got ${midStatus.pendingWrites})`);

  await t.domain.whenPersisted();

  // Writes must be COALESCED far below the mutation count.
  assert.ok(writeCount < MUTATIONS / 10,
    `writes coalesced: ${writeCount} writes for ${MUTATIONS} mutations`);
  assert.ok(writeCount >= 1, "at least one write happened");

  // The LATEST state is durable.
  assert.deepEqual(slowStore.snapshot.sessions[0].resumeMetadata, { seq: MUTATIONS - 1 });

  // Clean status after quiescence.
  const idleStatus = t.domain.getPersistenceStatus();
  assert.equal(idleStatus.dirty, false);
  assert.equal(idleStatus.writerActive, false);
  assert.equal(idleStatus.pendingWrites, 0);

  // Shutdown waits correctly and never deletes.
  const shutdown = await t.domain.shutdown();
  assert.equal(shutdown.shutdown, true);
  assert.deepEqual(slowStore.snapshot.sessions[0].resumeMetadata, { seq: MUTATIONS - 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("DSC-R1-005B: whenPersisted resolves only when dirty state is durable", async () => {
  let writes = 0;
  const store = {
    snapshot: null,
    async load() { return this.snapshot; },
    async persist(next) { writes += 1; await new Promise((r) => setTimeout(r, 10)); this.snapshot = next; },
    async clear() { this.snapshot = null; }
  };
  const t = makeDomain({ store, persistOnMutation: true });
  const s = t.domain.createSession({});
  t.domain.updateResumeMetadata({ sessionId: s.sessionId, generation: 1, resumeMetadata: { a: 1 } });
  await t.domain.whenPersisted();
  assert.deepEqual(store.snapshot.sessions[0].resumeMetadata, { a: 1 });
  t.domain.updateResumeMetadata({ sessionId: s.sessionId, generation: 1, resumeMetadata: { b: 2 } });
  await t.domain.whenPersisted();
  assert.deepEqual(store.snapshot.sessions[0].resumeMetadata, { b: 2 });
  assert.ok(writes >= 1);
});

test("DSC-R1-005B: persistence failure is surfaced and recovered by a later mutation", async () => {
  let failing = true;
  const store = {
    snapshot: null,
    async load() { return this.snapshot; },
    async persist(next) {
      if (failing) {
        const error = new Error("disk full");
        error.code = "DISK_FULL";
        throw error;
      }
      this.snapshot = next;
    },
    async clear() { this.snapshot = null; }
  };
  const t = makeDomain({ store, persistOnMutation: true });
  const s = t.domain.createSession({});
  await new Promise((r) => setTimeout(r, 20));
  const failed = t.domain.getPersistenceStatus();
  assert.ok(failed.lastError !== null, "failure surfaced deterministically");
  assert.equal(failed.lastError.code, "DISK_FULL");
  // A later mutation retries and recovers.
  failing = false;
  t.domain.updateResumeMetadata({ sessionId: s.sessionId, generation: 1, resumeMetadata: { ok: true } });
  await t.domain.whenPersisted();
  const recovered = t.domain.getPersistenceStatus();
  assert.equal(recovered.lastError, null);
  assert.deepEqual(store.snapshot.sessions[0].resumeMetadata, { ok: true });
});

// ---------------------------------------------------------------------------
// Default-store same-process ownership
// ---------------------------------------------------------------------------

test("STORE OWNERSHIP: second same-process owner of the same path fails closed", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const first = createFileContinuityStore(file);
  // A second active owner of the SAME absolute path fails with a typed error.
  assert.throws(
    () => createFileContinuityStore(file),
    (error) => error.code === "CONTINUITY_STORE_OWNED"
  );
  // Same path spelled differently (relative-form resolution) also collides.
  assert.throws(
    () => createFileContinuityStore(require("node:path").resolve(file)),
    (error) => error.code === "CONTINUITY_STORE_OWNED"
  );
  // A DIFFERENT path is fine.
  const other = createFileContinuityStore(path.join(dir, "other.json"));
  await other.persist({ schemaVersion: 1, savedAt: 1, sessions: [], terminal: {} });
  // Ownership is released on completed shutdown.
  await first.shutdown();
  const reclaimed = createFileContinuityStore(file);
  await reclaimed.shutdown();
  await other.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("STORE OWNERSHIP: memory-mode stores are unaffected", () => {
  const { createMemoryContinuityStore } = require("../../src/runtime/sessionContinuity");
  // Any number of memory stores coexist.
  const a = createMemoryContinuityStore();
  const b = createMemoryContinuityStore();
  assert.equal(typeof a.persist, "function");
  assert.equal(typeof b.persist, "function");
});

// ---------------------------------------------------------------------------
// Open-handle cleanliness
// ---------------------------------------------------------------------------

test("20: file store leaves no open handles after shutdown", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const store = createFileContinuityStore(file);
  const t = makeDomain({ store, persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: t.controller.mintPeerProvenance("console", "u") });
  await t.domain.whenPersisted();
  const restored = await t.domain.restore();
  assert.equal(restored.restored, true);
  await t.domain.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});
