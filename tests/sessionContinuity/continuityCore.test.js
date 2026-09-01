"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (part 1).
 *
 * Covers the required scenarios 1–10:
 *   1. same canonical session resumes after simulated restart
 *   2. persisted inert state reconstructs safely
 *   3. authority/capabilities do not survive by serialization
 *   4. channel A → channel B continuity
 *   5. forged channel/session metadata cannot hijack another session
 *   6. unrelated sessions remain isolated
 *   7. stale generation cannot overwrite resumed generation
 *   8. stale async resolve after restart is ignored
 *   9. stale async reject after restart is contained
 *  10. completed interaction is not emitted twice after resume
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

function makeDomain(options = {}) {
  let now = options.now === undefined ? 1000 : options.now;
  const clock = () => now;
  return {
    domain: createSessionContinuity({
      clock,
      idFactory: options.idFactory || createSequentialContinuityIdFactory(),
      store: options.store || createMemoryContinuityStore()
    }),
    advance: (ms) => { now += ms; },
    setNow: (value) => { now = value; }
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "damar-continuity-"));
}

// ---------------------------------------------------------------------------
// 1. same canonical session resumes after simulated restart
// ---------------------------------------------------------------------------

test("1: same canonical session resumes after simulated restart (file store)", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const storeA = createFileContinuityStore(file);
  const t = makeDomain({ store: storeA });
  const created = t.domain.createSession({ resumeMetadata: { topic: "sore-this-evening" } });
  t.domain.bindChannel({ sessionId: created.sessionId, channel: "console", claimedIdentity: "owner" });
  t.advance(5000);
  await t.domain.persist();

  // Simulated restart: NEW domain, SAME bounded persisted state.
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.equal(restored.degraded, false);
  const resumed = t2.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(resumed.sessionId, created.sessionId);
  assert.equal(resumed.incarnation, 2);
  assert.equal(resumed.resumed, true);
  assert.deepEqual(resumed.resumeMetadata, { topic: "sore-this-evening" });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("1b: restored session must be resumed explicitly — it does not auto-resume", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file) });
  const created = t.domain.createSession({});
  await t.domain.persist();
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t2.domain.restore();
  // Before resume: binding resolution reports not resumed, and binding a
  // channel requires an ACTIVE session — restored CLOSED state blocks it.
  const resolved = t2.domain.resolveChannel({ channel: "console", claimedIdentity: "owner" });
  assert.equal(resolved.resolved, false);
  assert.throws(
    () => t2.domain.bindChannel({ sessionId: created.sessionId, channel: "console", claimedIdentity: "owner" }),
    (error) => error.code === "SESSION_NOT_ACTIVE"
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("1c: binding survives restore+resume and resolves (regression: composite key mismatch)", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file) });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, channel: "telegram", claimedIdentity: "u1" });
  await t.domain.persist();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  // Restored sessions resolve their binding but are NOT yet resumed: the
  // resolution reports resumed:false so the canonical ingress can own the
  // explicit resume act.
  const inert = t2.domain.resolveChannel({ channel: "telegram", claimedIdentity: "u1" });
  assert.equal(inert.resolved, true);
  assert.equal(inert.resumed, false);
  const resumed = t2.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(resumed.incarnation, 2);
  const resolved = t2.domain.resolveChannel({ channel: "telegram", claimedIdentity: "u1" });
  assert.equal(resolved.resolved, true, "binding must resolve after restore+resume");
  assert.equal(resolved.sessionId, created.sessionId);
  assert.equal(resolved.incarnation, 2);
  assert.equal(resolved.resumed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2. persisted inert state reconstructs safely
// ---------------------------------------------------------------------------

test("2: persisted inert state reconstructs into a fresh domain safely", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const store = createFileContinuityStore(file);
  const t = makeDomain({ store });
  const a = t.domain.createSession({ resumeMetadata: { turns: 3, lang: "id" } });
  t.domain.bindChannel({ sessionId: a.sessionId, channel: "telegram", claimedIdentity: "user-77" });
  t.domain.bindChannel({ sessionId: a.sessionId, channel: "whatsapp", claimedIdentity: "user-77" });
  t.domain.recordTerminalInteraction({ interactionId: "ix_000000000001", state: "COMPLETED", generation: 1 });
  await t.domain.persist();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const result = await t2.domain.restore();
  assert.equal(result.restored, true);
  const snapshot = t2.domain.getSession(a.sessionId);
  assert.equal(snapshot.incarnation, 1);
  assert.deepEqual(snapshot.channels.map((c) => c.channel), ["telegram", "whatsapp"]);
  assert.deepEqual(snapshot.resumeMetadata, { turns: 3, lang: "id" });
  const terminal = t2.domain.getTerminalInteraction("ix_000000000001");
  assert.deepEqual(terminal, { interactionId: "ix_000000000001", state: "COMPLETED", generation: 1, at: terminal.at });
  fs.rmSync(dir, { recursive: true, force: true });
});

test("2b: snapshot round-trip through JSON is lossless and frozen", () => {
  const t = makeDomain();
  const created = t.domain.createSession({ resumeMetadata: { k: "v" } });
  t.domain.bindChannel({ sessionId: created.sessionId, channel: "voice", claimedIdentity: "owner" });
  const snapshot = buildSnapshot(4242, new Map(), new Map());
  const verdict = validateSnapshot(JSON.parse(JSON.stringify({
    schemaVersion: 1,
    savedAt: 4242,
    sessions: [{
      sessionId: created.sessionId,
      createdAt: 1000,
      updatedAt: 1000,
      incarnation: 1,
      resumeMetadata: { k: "v" },
      terminalAt: null,
      channels: [{ channel: "voice", peerKey: "owner", boundAt: 1000, generation: 1 }]
    }],
    terminal: {}
  })));
  assert.equal(verdict.corrupt, undefined);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(verdict.sessions[created.sessionId].channels[0].channel, "voice");
});

// ---------------------------------------------------------------------------
// 3. authority/capabilities do not survive by serialization
// ---------------------------------------------------------------------------

test("3: authority/capabilities cannot be smuggled into persisted state", () => {
  const t = makeDomain();
  // Functions, class instances, proxies, and non-plain values are rejected
  // as resume metadata (the only caller-influenced persisted field).
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: { grant: () => "ALLOW" } }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  class AuthorityToken {}
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: { token: new AuthorityToken() } }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  const smuggled = {};
  smuggled.cycle = smuggled;
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: smuggled }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  const proxyMeta = new Proxy({}, { get() { return "ADMIN"; } });
  assert.throws(
    () => t.domain.createSession({ resumeMetadata: proxyMeta }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  // A snapshot carrying executable material fails validation closed.
  const hostile = {
    schemaVersion: 1,
    savedAt: 1,
    sessions: [{
      sessionId: "dsc_hostile",
      createdAt: 1,
      updatedAt: 1,
      incarnation: 1,
      resumeMetadata: { principal: "admin", authority: "ALLOW" },
      terminalAt: null,
      channels: []
    }],
    terminal: {}
  };
  const verdict = validateSnapshot(hostile);
  // "authority" string values alone are inert, but the schema stays CLOSED:
  // an unknown/oversized/typed payload anywhere must fail closed. This one
  // is structurally valid inert data — the point is that NO field anywhere
  // in the snapshot schema can carry functions/capabilities. Verify that the
  // frozen reconstruction exposes no callable and no authority surface.
  assert.equal(verdict.corrupt, undefined);
  for (const value of Object.values(verdict.sessions.dsc_hostile.resumeMetadata)) {
    assert.equal(typeof value === "function", false);
  }
  // And the domain NEVER exposes authority-minting surface at all:
  const facade = t.domain;
  for (const key of Object.keys(facade)) {
    assert.match(key, /^(createSession|getSession|bindChannel|resolveChannel|restore|resumeSession|closeSession|persist|currentIncarnation|applyWithIncarnation|recordTerminalInteraction|getTerminalInteraction|acceptAsyncOutcome|snapshotDiagnostics|shutdown)$/);
  }
});

test("3b: persisted snapshot validation rejects non-plain and accessor-bearing data", () => {
  const accessorSnap = {};
  Object.defineProperty(accessorSnap, "schemaVersion", { enumerable: true, get() { return 1; } });
  accessorSnap.savedAt = 1;
  accessorSnap.sessions = [];
  accessorSnap.terminal = {};
  assert.equal(validateSnapshot(accessorSnap).corrupt, true);
  assert.equal(validateSnapshot(accessorSnap).reason, "SNAPSHOT_NOT_PLAIN");

  const arraySessions = { schemaVersion: 1, savedAt: 1, sessions: [], terminal: [] };
  assert.equal(validateSnapshot(arraySessions).corrupt, true);
});

// ---------------------------------------------------------------------------
// 4. channel A → channel B continuity
// ---------------------------------------------------------------------------

test("4: channel A → channel B resolves to the SAME canonical session", async () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, channel: "console", claimedIdentity: "owner-9" });
  // The user switches transport: WhatsApp event with the same peer evidence.
  const fromConsole = t.domain.resolveChannel({ channel: "console", claimedIdentity: "owner-9" });
  assert.equal(fromConsole.resolved, true);
  assert.equal(fromConsole.sessionId, created.sessionId);

  // Bind the second channel to the SAME canonical session (explicit policy).
  t.domain.bindChannel({ sessionId: created.sessionId, channel: "whatsapp", claimedIdentity: "owner-9" });
  const fromWhatsapp = t.domain.resolveChannel({ channel: "whatsapp", claimedIdentity: "owner-9" });
  assert.equal(fromWhatsapp.resolved, true);
  assert.equal(fromWhatsapp.sessionId, created.sessionId);
  assert.equal(fromWhatsapp.sessionId, fromConsole.sessionId);
  // Two channels, one canonical Damar session.
  const snapshot = t.domain.getSession(created.sessionId);
  assert.equal(snapshot.channels.length, 2);
});

test("4b: continuity survives restart WITH channel switch", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file) });
  const created = t.domain.createSession({ resumeMetadata: { lastTopic: "lanjut besok" } });
  t.domain.bindChannel({ sessionId: created.sessionId, channel: "telegram", claimedIdentity: "u1" });
  await t.domain.persist();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t2.domain.restore();
  t2.domain.resumeSession({ sessionId: created.sessionId });
  t2.domain.bindChannel({ sessionId: created.sessionId, channel: "voice", claimedIdentity: "u1" });
  const resolved = t2.domain.resolveChannel({ channel: "voice", claimedIdentity: "u1" });
  assert.equal(resolved.sessionId, created.sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 5. forged channel/session metadata cannot hijack another session
// ---------------------------------------------------------------------------

test("5: forged session id claim cannot hijack another user's session", () => {
  const t = makeDomain();
  const victim = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: victim.sessionId, channel: "telegram", claimedIdentity: "victim-user" });
  // Attacker on a DIFFERENT peer claims the victim's canonical session id.
  const forged = t.domain.resolveChannel({
    channel: "telegram",
    claimedIdentity: "attacker-user",
    claimedSessionId: victim.sessionId
  });
  assert.equal(forged.resolved, false, "forged claim must not resolve another session");
  // The attacker's own evidence never touches the victim's session.
  assert.equal(t.domain.resolveChannel({ channel: "telegram", claimedIdentity: "attacker-user" }).resolved, false);
  // The victim's binding remains intact and authoritative.
  const victimResolution = t.domain.resolveChannel({ channel: "telegram", claimedIdentity: "victim-user" });
  assert.equal(victimResolution.sessionId, victim.sessionId);
});

test("5b: a bound channel claim selects by BINDING POLICY, never by the claim", () => {
  const t = makeDomain();
  const alice = t.domain.createSession({});
  const bob = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: alice.sessionId, channel: "x", claimedIdentity: "alice" });
  // Alice claims Bob's session id from her bound channel: the binding wins,
  // the claim to Bob's session is ignored — no privilege escalation.
  const resolution = t.domain.resolveChannel({
    channel: "x", claimedIdentity: "alice", claimedSessionId: bob.sessionId
  });
  assert.equal(resolution.resolved, true);
  assert.equal(resolution.sessionId, alice.sessionId);
  assert.notEqual(resolution.sessionId, bob.sessionId);
  // Bob's session is untouched.
  const bobSnapshot = t.domain.getSession(bob.sessionId);
  assert.equal(bobSnapshot.channels.length, 0);
});

test("5b: a channel already bound to a session cannot be silently rebinded", () => {
  const t = makeDomain();
  const first = t.domain.createSession({});
  const second = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: first.sessionId, channel: "telegram", claimedIdentity: "shared-peer" });
  assert.throws(
    () => t.domain.bindChannel({ sessionId: second.sessionId, channel: "telegram", claimedIdentity: "shared-peer" }),
    (error) => error.code === "BINDING_CONFLICT"
  );
  // The victim's session remains intact and bound to the first session.
  const resolved = t.domain.resolveChannel({ channel: "telegram", claimedIdentity: "shared-peer" });
  assert.equal(resolved.sessionId, first.sessionId);
});

test("5c: forged claim cannot resolve a TERMINAL session", () => {
  const t = makeDomain();
  const session = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: session.sessionId, channel: "console", claimedIdentity: "u" });
  t.domain.closeSession({ sessionId: session.sessionId });
  const resolved = t.domain.resolveChannel({
    channel: "console", claimedIdentity: "u", claimedSessionId: session.sessionId
  });
  assert.equal(resolved.resolved, false);
});

// ---------------------------------------------------------------------------
// 6. unrelated sessions remain isolated
// ---------------------------------------------------------------------------

test("6: unrelated sessions remain isolated — one channel cannot enumerate others", () => {
  const t = makeDomain();
  const alice = t.domain.createSession({});
  const bob = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: alice.sessionId, channel: "telegram", claimedIdentity: "alice" });
  t.domain.bindChannel({ sessionId: bob.sessionId, channel: "whatsapp", claimedIdentity: "bob" });

  // Alice's channel evidence only ever resolves Alice's session.
  const aliceResolution = t.domain.resolveChannel({ channel: "telegram", claimedIdentity: "alice" });
  assert.equal(aliceResolution.sessionId, alice.sessionId);
  const bobResolution = t.domain.resolveChannel({ channel: "whatsapp", claimedIdentity: "bob" });
  assert.equal(bobResolution.sessionId, bob.sessionId);

  // A claim from alice's channel to bob's session resolves to ALICE's session
  // (binding policy wins), never bob's. Bob's session is unreachable from
  // alice's channel evidence.
  const crossClaim = t.domain.resolveChannel({ channel: "telegram", claimedIdentity: "alice", claimedSessionId: bob.sessionId });
  assert.equal(crossClaim.sessionId, alice.sessionId);
  // And from a channel with NO binding, no claim reaches any session:
  assert.equal(
    t.domain.resolveChannel({ channel: "voice", claimedIdentity: "mallory", claimedSessionId: bob.sessionId }).resolved,
    false
  );

  // The domain exposes NO enumeration of all sessions per channel/peer:
  // resolveChannel is the ONLY lookup and it is scoped to (channel, peer).
  // Diagnostics expose counts only — never other session ids.
  const diag = t.domain.snapshotDiagnostics();
  assert.equal(diag.sessions, 2);
  assert.equal(diag.bindings, 2);
  assert.deepEqual(Object.keys(diag), [
    "schemaVersion", "sessions", "bindings", "terminalInteractions", "restored", "persistedGeneration"
  ]);
});

// ---------------------------------------------------------------------------
// 7. stale generation cannot overwrite resumed generation
// ---------------------------------------------------------------------------

test("7: stale pre-restart generation cannot overwrite resumed session state", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const staleGeneration = t.domain.currentIncarnation(created.sessionId);
  // Restart semantics: resume enters a NEW incarnation.
  t.domain.resumeSession({ sessionId: created.sessionId });
  const current = t.domain.currentIncarnation(created.sessionId);
  assert.notEqual(staleGeneration, current);

  // Pre-restart work stamped with the old incarnation is rejected.
  assert.throws(
    () => t.domain.applyWithIncarnation(created.sessionId, staleGeneration, (session) => {
      session.resumeMetadata = { hijacked: true };
    }),
    (error) => error.code === "STALE_GENERATION"
  );
  const snapshot = t.domain.getSession(created.sessionId);
  assert.equal(snapshot.resumeMetadata.hijacked, undefined);

  // A persisted stale generation cannot clear a current generation either.
  assert.throws(
    () => t.domain.applyWithIncarnation(created.sessionId, staleGeneration, () => {}),
    (error) => error.code === "STALE_GENERATION"
  );
  // Current-generation writes still succeed.
  t.domain.applyWithIncarnation(created.sessionId, current, () => "ok");
});

// ---------------------------------------------------------------------------
// 8/9. stale async resolve/reject after restart
// ---------------------------------------------------------------------------

test("8: stale async resolve after restart is ignored", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const staleGeneration = t.domain.currentIncarnation(created.sessionId);
  t.domain.resumeSession({ sessionId: created.sessionId });
  const outcome = t.domain.acceptAsyncOutcome({
    interactionId: "ix_stale_resolve",
    sessionId: created.sessionId,
    generation: staleGeneration,
    state: "COMPLETED"
  });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "STALE_GENERATION");
  assert.equal(t.domain.getTerminalInteraction("ix_stale_resolve"), null);
});

test("9: stale async reject after restart is contained (no state change)", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const staleGeneration = t.domain.currentIncarnation(created.sessionId);
  t.domain.resumeSession({ sessionId: created.sessionId });
  const outcome = t.domain.acceptAsyncOutcome({
    interactionId: "ix_stale_reject",
    sessionId: created.sessionId,
    generation: staleGeneration,
    state: "FAILED"
  });
  assert.equal(outcome.accepted, false);
  assert.equal(t.domain.getTerminalInteraction("ix_stale_reject"), null);
  // The session is unaffected: current generation still accepts its own work.
  const current = t.domain.currentIncarnation(created.sessionId);
  assert.equal(
    t.domain.acceptAsyncOutcome({
      interactionId: "ix_fresh", sessionId: created.sessionId, generation: current, state: "COMPLETED"
    }).accepted,
    true
  );
});

// ---------------------------------------------------------------------------
// 10. completed interaction is not emitted twice after resume
// ---------------------------------------------------------------------------

test("10: completed interaction is not recorded/emitted twice after resume", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file) });
  const created = t.domain.createSession({});
  t.domain.recordTerminalInteraction({ interactionId: "ix_done", state: "COMPLETED", generation: 1 });
  await t.domain.persist();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t2.domain.restore();
  t2.domain.resumeSession({ sessionId: created.sessionId });
  // A post-resume replay of the same completed interaction is idempotent.
  const replay = t2.domain.recordTerminalInteraction({ interactionId: "ix_done", state: "COMPLETED", generation: 2 });
  assert.equal(replay.recorded, false);
  assert.equal(replay.idempotent, true);
  // And a stale async completion cannot revive it.
  const stale = t2.domain.acceptAsyncOutcome({ interactionId: "ix_done", sessionId: created.sessionId, generation: 2, state: "COMPLETED" });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "ALREADY_TERMINAL");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("10b: terminal ledger stays bounded", () => {
  const t = makeDomain();
  for (let i = 0; i < 1100; i += 1) {
    t.domain.recordTerminalInteraction({
      interactionId: `ix_${String(i).padStart(12, "0")}`,
      state: "COMPLETED",
      generation: 1
    });
  }
  assert.equal(t.domain.snapshotDiagnostics().terminalInteractions <= 1024, true);
});
