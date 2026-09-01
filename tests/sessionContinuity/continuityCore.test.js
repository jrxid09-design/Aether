"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (repair R1, part 1).
 *
 * Covers the audited-invariant scenarios 1–10 PLUS the DSC-001 adversarial
 * peer-provenance matrix, DSC-002 mutable-state-leak proofs, and DSC-004
 * atomic terminal-ownership races.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createSessionContinuity,
  mintPeerProvenance,
  isPeerProvenance,
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
      store: options.store || createMemoryContinuityStore(),
      persistOnMutation: options.persistOnMutation === true
    }),
    advance: (ms) => { now += ms; },
    setNow: (value) => { now = value; }
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "damar-continuity-"));
}

const prov = (channel, peer) => mintPeerProvenance(channel, peer);

// ---------------------------------------------------------------------------
// 1. same canonical session resumes after simulated restart
// ---------------------------------------------------------------------------

test("1: same canonical session resumes after simulated restart (file store)", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({ resumeMetadata: { topic: "sore-this-evening" } });
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("console", "owner") });
  await t.domain.whenPersisted();

  // Simulated restart: NEW domain, SAME durable persisted state.
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.equal(restored.degraded, false);
  // RESTORED != RESUMED: the restored session is CLOSED until explicit resume.
  const before = t2.domain.getSession(created.sessionId);
  assert.equal(before.state, "CLOSED");
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
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("console", "owner") });
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t.domain.whenPersisted();
  await t2.domain.restore();
  // Binding resolution reports resolved-but-not-resumed; binding a NEW
  // channel requires an ACTIVE session — restored CLOSED state blocks it.
  const resolution = t2.domain.resolveChannel({ provenance: prov("console", "owner") });
  assert.equal(resolution.resolved, true);
  assert.equal(resolution.resumed, false);
  assert.throws(
    () => t2.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("telegram", "owner") }),
    (error) => error.code === "SESSION_NOT_ACTIVE"
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("1c: binding survives restore+resume and resolves (regression: composite key mismatch)", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("telegram", "u1") });
  await t.domain.whenPersisted();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  const inert = t2.domain.resolveChannel({ provenance: prov("telegram", "u1") });
  assert.equal(inert.resolved, true);
  assert.equal(inert.resumed, false);
  const resumed = t2.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(resumed.incarnation, 2);
  const resolved = t2.domain.resolveChannel({ provenance: prov("telegram", "u1") });
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
  const t = makeDomain({ store, persistOnMutation: true });
  const a = t.domain.createSession({ resumeMetadata: { turns: 3, lang: "id" } });
  t.domain.bindChannel({ sessionId: a.sessionId, provenance: prov("telegram", "user-77") });
  t.domain.bindChannel({ sessionId: a.sessionId, provenance: prov("whatsapp", "user-77") });
  t.domain.commitTerminalOutcome({ sessionId: a.sessionId, interactionId: "ix_000000000001", generation: 1, state: "COMPLETED" });
  await t.domain.whenPersisted();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const result = await t2.domain.restore();
  assert.equal(result.restored, true);
  const snapshot = t2.domain.getSession(a.sessionId);
  assert.equal(snapshot.incarnation, 1);
  assert.deepEqual(snapshot.channels.map((c) => c.channel), ["telegram", "whatsapp"]);
  assert.deepEqual(snapshot.resumeMetadata, { turns: 3, lang: "id" });
  const terminal = t2.domain.getTerminalInteraction("ix_000000000001");
  assert.equal(terminal.state, "COMPLETED");
  assert.equal(terminal.sessionId, a.sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("2b: snapshot round-trip through JSON is lossless and frozen", () => {
  const t = makeDomain();
  const created = t.domain.createSession({ resumeMetadata: { k: "v" } });
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("voice", "owner") });
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
      channels: [{ channel: "voice", peer: "owner", boundAt: 1000, generation: 1 }]
    }],
    terminal: {}
  })));
  assert.equal(verdict.corrupt, undefined);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(verdict.sessions[created.sessionId].channels[0].channel, "voice");
});

// ---------------------------------------------------------------------------
// 3. authority/capabilities do not survive by serialization (DSC-002)
// ---------------------------------------------------------------------------

test("3: authority/capabilities cannot be smuggled into persisted state", () => {
  const t = makeDomain();
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
  // Snapshot reconstruction exposes no callable and no authority surface.
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
  assert.equal(verdict.corrupt, undefined);
  for (const value of Object.values(verdict.sessions.dsc_hostile.resumeMetadata)) {
    assert.equal(typeof value === "function", false);
  }
});

test("3b: persisted snapshot validation rejects non-plain and accessor-bearing data", () => {
  const accessorSnap = {};
  Object.defineProperty(accessorSnap, "schemaVersion", { enumerable: true, get() { return 1; } });
  accessorSnap.savedAt = 1;
  accessorSnap.sessions = [];
  accessorSnap.terminal = {};
  assert.equal(validateSnapshot(accessorSnap).corrupt, true);
  const arraySessions = { schemaVersion: 1, savedAt: 1, sessions: [], terminal: [] };
  assert.equal(validateSnapshot(arraySessions).corrupt, true);
});

// ---------------------------------------------------------------------------
// DSC-002 — mutable canonical state leak
// ---------------------------------------------------------------------------

test("DSC-002: no public method accepts or returns mutable canonical state", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("console", "u") });

  // applyWithIncarnation (the audited mutable-callback hole) is REMOVED.
  assert.equal("applyWithIncarnation" in t.domain, false);

  // Session views are frozen inert projections; mutating a view cannot
  // affect canonical state.
  const view = t.domain.getSession(created.sessionId);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.channels[0]), true);
  assert.throws(() => { view.incarnation = 99; }, TypeError);
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.equal(t.domain.getSession(created.sessionId).incarnation, 2, "view mutation had no effect");

  // There is no property exposing the raw session map, binding index,
  // terminal ledger, or store.
  for (const key of Object.keys(t.domain)) {
    assert.match(key, /^(createSession|getSession|bindChannel|unbindChannel|resolveChannel|resumeSession|closeSession|persist|restore|currentIncarnation|checkIncarnation|commitTerminalOutcome|getTerminalInteraction|acceptAsyncOutcome|updateResumeMetadata|snapshotDiagnostics|getPersistenceStatus|whenPersisted|shutdown|resetDurableState|__trusted)$/);
  }
  const diag = t.domain.snapshotDiagnostics();
  assert.deepEqual(Object.keys(diag).sort(), ["bindings", "degradedReason", "persistence", "restored", "schemaVersion", "sessions", "terminalInteractions", "persistedGeneration"].sort());
});

test("DSC-002: metadata mutation is a closed validated operation", () => {
  const t = makeDomain();
  const created = t.domain.createSession({ resumeMetadata: { safe: 1 } });
  const generation = t.domain.currentIncarnation(created.sessionId);

  // Invalid metadata fails BEFORE mutation (state unchanged).
  assert.throws(
    () => t.domain.updateResumeMetadata({
      sessionId: created.sessionId, generation, resumeMetadata: { evil: () => 1 }
    }),
    (error) => error.code === "RESUME_METADATA_INVALID"
  );
  assert.deepEqual(t.domain.getSession(created.sessionId).resumeMetadata, { safe: 1 });

  // Valid closed update mutates internally and returns a frozen result.
  const updated = t.domain.updateResumeMetadata({
    sessionId: created.sessionId, generation, resumeMetadata: { safe: 2, note: "ok" }
  });
  assert.equal(Object.isFrozen(updated), true);
  assert.deepEqual(updated.resumeMetadata, { safe: 2, note: "ok" });

  // Stale generation can never mutate a new incarnation.
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.throws(
    () => t.domain.updateResumeMetadata({
      sessionId: created.sessionId, generation, resumeMetadata: { hijack: true }
    }),
    (error) => error.code === "STALE_GENERATION"
  );
  assert.deepEqual(t.domain.getSession(created.sessionId).resumeMetadata, { safe: 2, note: "ok" });
});

test("DSC-002: persistence remains valid after all public operations", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("telegram", "u1") });
  t.domain.updateResumeMetadata({ sessionId: created.sessionId, generation: 1, resumeMetadata: { a: 1 } });
  t.domain.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "ix_a", generation: 1, state: "COMPLETED" });
  t.domain.resumeSession({ sessionId: created.sessionId });
  await t.domain.persist();

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.equal(restored.degraded, false);
  const snapshot = t2.domain.getSession(created.sessionId);
  assert.equal(snapshot.incarnation, 2);
  assert.deepEqual(snapshot.resumeMetadata, { a: 1 });
  assert.equal(t2.domain.getTerminalInteraction("ix_a").state, "COMPLETED");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// DSC-001 — trusted peer provenance / binding hijack
// ---------------------------------------------------------------------------

test("DSC-001: provenance is required and cannot be forged", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  // A lookalike object without the trusted mint is rejected.
  const forged = Object.freeze({ kind: "PeerProvenance", channel: "telegram", peer: "u1", key: "telegram\u0000u1" });
  assert.equal(isPeerProvenance(forged), false);
  assert.throws(
    () => t.domain.bindChannel({ sessionId: created.sessionId, provenance: forged }),
    (error) => error.code === "PROVENANCE_UNTRUSTED"
  );
  assert.throws(
    () => t.domain.resolveChannel({ provenance: forged }),
    (error) => error.code === "PROVENANCE_UNTRUSTED"
  );
  // Only the trusted mint produces valid provenance.
  const trusted = prov("telegram", "u1");
  assert.equal(isPeerProvenance(trusted), true);
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: trusted });
  assert.equal(t.domain.resolveChannel({ provenance: trusted }).sessionId, created.sessionId);
});

test("DSC-001: Alice vs alice stay DISTINCT (exact-case peer identity)", () => {
  const t = makeDomain();
  const aliceUpper = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: aliceUpper.sessionId, provenance: prov("telegram", "Alice") });
  // 'alice' (lowercase) is a DIFFERENT exact peer: no binding, no collision.
  const lower = t.domain.resolveChannel({ provenance: prov("telegram", "alice") });
  assert.equal(lower.resolved, false);
  // Binding 'alice' to another session coexists without conflict.
  const aliceLower = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: aliceLower.sessionId, provenance: prov("telegram", "alice") });
  assert.notEqual(
    t.domain.resolveChannel({ provenance: prov("telegram", "Alice") }).sessionId,
    t.domain.resolveChannel({ provenance: prov("telegram", "alice") }).sessionId
  );
});

test("DSC-001: punctuation-different identities stay distinct", () => {
  const t = makeDomain();
  const a = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: a.sessionId, provenance: prov("whatsapp", "user.official") });
  // None of these may collide with 'user.official' under exact identity.
  for (const different of ["user official", "user_official", "userofficial", "user.Official", "user..official"]) {
    assert.equal(t.domain.resolveChannel({ provenance: prov("whatsapp", different) }).resolved, false, different);
  }
});

test("DSC-001: missing identity fails closed — no shared anon continuity", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("console", "real-user") });
  // Missing/empty peer cannot mint provenance at all.
  for (const missing of [null, undefined, "", "   "]) {
    assert.throws(
      () => prov("console", missing),
      (error) => error.code === "PROVENANCE_PEER_INVALID",
      JSON.stringify(missing)
    );
  }
  // No "anon" binding was created as a side effect.
  assert.equal(t.domain.resolveChannel({ provenance: prov("console", "anon") }).resolved, false);
  // No anonymous session was minted for other callers.
  assert.equal(t.domain.snapshotDiagnostics().sessions, 1);
});

test("DSC-001: same textual peer on different channels stays distinct", () => {
  const t = makeDomain();
  const tg = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: tg.sessionId, provenance: prov("telegram", "u1") });
  // Same text on WhatsApp: NOT resolved (different channel namespace).
  const wa = t.domain.resolveChannel({ provenance: prov("whatsapp", "u1") });
  assert.equal(wa.resolved, false);
  // It binds to a DIFFERENT session without conflict.
  const waSession = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: waSession.sessionId, provenance: prov("whatsapp", "u1") });
  assert.notEqual(
    t.domain.resolveChannel({ provenance: prov("telegram", "u1") }).sessionId,
    t.domain.resolveChannel({ provenance: prov("whatsapp", "u1") }).sessionId
  );
});

test("DSC-001: binding takeover attempt fails closed", () => {
  const t = makeDomain();
  const victim = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: victim.sessionId, provenance: prov("telegram", "victim") });
  const attacker = t.domain.createSession({});
  // The attacker session cannot steal the victim's trusted binding.
  assert.throws(
    () => t.domain.bindChannel({ sessionId: attacker.sessionId, provenance: prov("telegram", "victim") }),
    (error) => error.code === "BINDING_CONFLICT"
  );
  // Victim resolution is unchanged.
  assert.equal(t.domain.resolveChannel({ provenance: prov("telegram", "victim") }).sessionId, victim.sessionId);
});

test("DSC-001: no public rebind flag — transfer exists only on the trusted seam", () => {
  const t = makeDomain();
  const first = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: first.sessionId, provenance: prov("telegram", "shared") });
  const second = t.domain.createSession({});
  // The PUBLIC bindChannel has NO rebind option.
  assert.throws(
    () => t.domain.bindChannel({ sessionId: second.sessionId, provenance: prov("telegram", "shared"), rebind: true }),
    (error) => error.code === "BINDING_CONFLICT"
  );
  // trustedTransferBinding is NOT on the public facade.
  assert.equal("trustedTransferBinding" in t.domain, false);
});

test("DSC-001: trusted explicit cross-channel unification (composition seam)", () => {
  const t = makeDomain();
  const canonical = t.domain.createSession({});
  // The trusted composition root binds two channels to the SAME canonical
  // session — explicit runtime act, mints no authority.
  t.domain.bindChannel({ sessionId: canonical.sessionId, provenance: prov("telegram", "u1") });
  t.domain.bindChannel({ sessionId: canonical.sessionId, provenance: prov("console", "u1") });
  const tg = t.domain.resolveChannel({ provenance: prov("telegram", "u1") });
  const co = t.domain.resolveChannel({ provenance: prov("console", "u1") });
  assert.equal(tg.sessionId, canonical.sessionId);
  assert.equal(co.sessionId, canonical.sessionId);
  assert.equal(tg.sessionId, co.sessionId);
});

test("DSC-001: binding TRANSFER exists only on the trusted controller (untrusted rebind rejected)", () => {
  const sc = require("../../src/runtime/sessionContinuity/continuity");
  const ids = require("../../src/runtime/sessionContinuity/ids");
  const domain = sc.createSessionContinuity({ clock: () => 1000, idFactory: ids.createSequentialContinuityIdFactory() });
  const controller = sc._resolveTrustedController(domain.__trusted.controller);
  const first = domain.createSession({});
  const second = domain.createSession({});
  const provenance = controller.mintPeerProvenance("telegram", "u1");
  domain.bindChannel({ sessionId: first.sessionId, provenance });
  // The PUBLIC facade cannot rebind even with an explicit flag.
  assert.throws(
    () => domain.bindChannel({ sessionId: second.sessionId, provenance, rebind: true }),
    (error) => error.code === "BINDING_CONFLICT"
  );
  assert.equal("trustedTransferBinding" in domain, false);
  // The TRUSTED controller can transfer — an explicit composition act that
  // moves identity continuity only (never authority).
  const transfer = controller.trustedTransferBinding({ provenance, toSessionId: second.sessionId });
  assert.equal(transfer.fromSessionId, first.sessionId);
  assert.equal(transfer.toSessionId, second.sessionId);
  assert.equal(domain.resolveChannel({ provenance }).sessionId, second.sessionId);
  // The previous session no longer owns the binding.
  assert.equal(domain.getSession(first.sessionId).channels.length, 0);
});

// ---------------------------------------------------------------------------
// 4/5/6 — continuity, hijack, isolation
// ---------------------------------------------------------------------------

test("4: channel A → channel B resolves to the SAME canonical session (trusted binding)", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("console", "owner-9") });
  const fromConsole = t.domain.resolveChannel({ provenance: prov("console", "owner-9") });
  assert.equal(fromConsole.resolved, true);

  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("whatsapp", "owner-9") });
  const fromWhatsapp = t.domain.resolveChannel({ provenance: prov("whatsapp", "owner-9") });
  assert.equal(fromWhatsapp.resolved, true);
  assert.equal(fromWhatsapp.sessionId, fromConsole.sessionId);
  const snapshot = t.domain.getSession(created.sessionId);
  assert.equal(snapshot.channels.length, 2);
});

test("4b: continuity survives restart WITH channel switch", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({ resumeMetadata: { lastTopic: "lanjut besok" } });
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("telegram", "u1") });

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t.domain.whenPersisted();
  await t2.domain.restore();
  t2.domain.resumeSession({ sessionId: created.sessionId });
  t2.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("voice", "u1") });
  const resolved = t2.domain.resolveChannel({ provenance: prov("voice", "u1") });
  assert.equal(resolved.sessionId, created.sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("5: forged session id claim cannot hijack another user's session", () => {
  const t = makeDomain();
  const victim = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: victim.sessionId, provenance: prov("telegram", "victim-user") });
  // The attacker's own provenance never touches the victim's session.
  assert.equal(t.domain.resolveChannel({ provenance: prov("telegram", "attacker-user") }).resolved, false);
  // The victim's binding remains authoritative.
  assert.equal(t.domain.resolveChannel({ provenance: prov("telegram", "victim-user") }).sessionId, victim.sessionId);
});

test("5c: forged claim cannot resolve a TERMINAL session", () => {
  const t = makeDomain();
  const session = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: session.sessionId, provenance: prov("console", "u") });
  t.domain.closeSession({ sessionId: session.sessionId });
  const resolved = t.domain.resolveChannel({ provenance: prov("console", "u") });
  assert.equal(resolved.resolved, false);
});

test("6: unrelated sessions remain isolated — no enumeration surface", () => {
  const t = makeDomain();
  const alice = t.domain.createSession({});
  const bob = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: alice.sessionId, provenance: prov("telegram", "alice") });
  t.domain.bindChannel({ sessionId: bob.sessionId, provenance: prov("whatsapp", "bob") });
  assert.equal(t.domain.resolveChannel({ provenance: prov("telegram", "alice") }).sessionId, alice.sessionId);
  assert.equal(t.domain.resolveChannel({ provenance: prov("whatsapp", "bob") }).sessionId, bob.sessionId);
  // An unbound peer can never reach any session.
  assert.equal(t.domain.resolveChannel({ provenance: prov("voice", "mallory") }).resolved, false);
  const diag = t.domain.snapshotDiagnostics();
  assert.equal(diag.sessions, 2);
  assert.equal(diag.bindings, 2);
  // Diagnostics contain counts only — no session ids, no peer keys.
  assert.deepEqual(Object.keys(diag).sort(), ["bindings", "degradedReason", "persistence", "restored", "schemaVersion", "sessions", "terminalInteractions", "persistedGeneration"].sort());
});

// ---------------------------------------------------------------------------
// 7/8/9 — generation / stale async work
// ---------------------------------------------------------------------------

test("7: stale pre-restart generation cannot overwrite resumed session state", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const staleGeneration = t.domain.currentIncarnation(created.sessionId);
  t.domain.resumeSession({ sessionId: created.sessionId });
  const current = t.domain.currentIncarnation(created.sessionId);
  assert.notEqual(staleGeneration, current);
  // The only mutation path (updateResumeMetadata) rejects stale generations.
  assert.throws(
    () => t.domain.updateResumeMetadata({ sessionId: created.sessionId, generation: staleGeneration, resumeMetadata: { hijacked: true } }),
    (error) => error.code === "STALE_GENERATION"
  );
  assert.equal(t.domain.getSession(created.sessionId).resumeMetadata.hijacked, undefined);
  // Current-generation writes still succeed.
  t.domain.updateResumeMetadata({ sessionId: created.sessionId, generation: current, resumeMetadata: { ok: true } });
  assert.deepEqual(t.domain.getSession(created.sessionId).resumeMetadata, { ok: true });
});

test("8: stale async resolve after restart is ignored", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const staleGeneration = t.domain.currentIncarnation(created.sessionId);
  t.domain.resumeSession({ sessionId: created.sessionId });
  const outcome = t.domain.acceptAsyncOutcome({
    interactionId: "ix_stale_resolve", sessionId: created.sessionId, generation: staleGeneration
  });
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.reason, "STALE_GENERATION");
  assert.equal(t.domain.getTerminalInteraction("ix_stale_resolve"), null);
});

test("9: stale async reject after restart is contained", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const staleGeneration = t.domain.currentIncarnation(created.sessionId);
  t.domain.resumeSession({ sessionId: created.sessionId });
  const outcome = t.domain.acceptAsyncOutcome({
    interactionId: "ix_stale_reject", sessionId: created.sessionId, generation: staleGeneration
  });
  assert.equal(outcome.accepted, false);
  assert.equal(t.domain.getTerminalInteraction("ix_stale_reject"), null);
  const current = t.domain.currentIncarnation(created.sessionId);
  assert.equal(t.domain.acceptAsyncOutcome({ interactionId: "ix_fresh", sessionId: created.sessionId, generation: current }).accepted, true);
});

// ---------------------------------------------------------------------------
// DSC-004 — atomic terminal ownership
// ---------------------------------------------------------------------------

test("DSC-004: terminal commit is atomic and incarnation-owned", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const first = t.domain.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_one", generation: 1, state: "COMPLETED"
  });
  assert.equal(first.recorded, true);
  // Duplicate same interaction: idempotent, FIRST state wins.
  const dup = t.domain.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_one", generation: 1, state: "FAILED"
  });
  assert.equal(dup.recorded, false);
  assert.equal(dup.idempotent, true);
  assert.equal(dup.state, "COMPLETED");
  // Stale incarnation: fails WITHOUT mutating terminal state.
  t.domain.resumeSession({ sessionId: created.sessionId });
  assert.throws(
    () => t.domain.commitTerminalOutcome({
      sessionId: created.sessionId, interactionId: "ix_two", generation: 1, state: "COMPLETED"
    }),
    (error) => error.code === "STALE_GENERATION"
  );
  assert.equal(t.domain.getTerminalInteraction("ix_two"), null);
  // Current incarnation succeeds.
  const current = t.domain.currentIncarnation(created.sessionId);
  const second = t.domain.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_two", generation: current, state: "FAILED"
  });
  assert.equal(second.recorded, true);
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

test("DSC-004: unknown session/interaction/generation are rejected without mutation", () => {
  const t = makeDomain();
  assert.throws(
    () => t.domain.commitTerminalOutcome({ sessionId: "dsc_missing", interactionId: "ix_x", generation: 1, state: "COMPLETED" }),
    (error) => error.code === "INVALID_CONTINUITY_ID" || error.code === "SESSION_NOT_FOUND"
  );
  const created = t.domain.createSession({});
  assert.throws(
    () => t.domain.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "not-ix", generation: 1, state: "COMPLETED" }),
    (error) => error.code === "INTERACTION_ID_INVALID"
  );
  assert.throws(
    () => t.domain.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "ix_x", generation: 0, state: "COMPLETED" }),
    (error) => error.code === "GENERATION_INVALID"
  );
  assert.throws(
    () => t.domain.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "ix_x", generation: 1, state: "STILL_RUNNING" }),
    (error) => error.code === "TERMINAL_STATE_INVALID"
  );
});

test("DSC-004: two concurrent terminal attempts — exactly one records, first wins", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  const attempts = [];
  for (const state of ["COMPLETED", "FAILED", "CANCELLED"]) {
    attempts.push(t.domain.commitTerminalOutcome({
      sessionId: created.sessionId, interactionId: "ix_race", generation: 1, state
    }));
  }
  const recorded = attempts.filter((a) => a.recorded);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].state, "COMPLETED", "first terminal state wins");
  const ledger = t.domain.getTerminalInteraction("ix_race");
  assert.equal(ledger.state, "COMPLETED");
});

test("DSC-004: close/resume race — resume of a closed session fails closed", () => {
  const t = makeDomain();
  const created = t.domain.createSession({});
  t.domain.closeSession({ sessionId: created.sessionId });
  assert.throws(
    () => t.domain.resumeSession({ sessionId: created.sessionId }),
    (error) => error.code === "SESSION_TERMINAL"
  );
});

// ---------------------------------------------------------------------------
// 10 — idempotent terminals after resume
// ---------------------------------------------------------------------------

test("10: completed interaction is not recorded/emitted twice after resume", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.commitTerminalOutcome({ sessionId: created.sessionId, interactionId: "ix_done", generation: 1, state: "COMPLETED" });

  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  await t.domain.whenPersisted();
  await t2.domain.restore();
  t2.domain.resumeSession({ sessionId: created.sessionId });
  const replay = t2.domain.commitTerminalOutcome({
    sessionId: created.sessionId, interactionId: "ix_done", generation: 2, state: "COMPLETED"
  });
  assert.equal(replay.recorded, false);
  assert.equal(replay.idempotent, true);
  const stale = t2.domain.acceptAsyncOutcome({ interactionId: "ix_done", sessionId: created.sessionId, generation: 2 });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "ALREADY_TERMINAL");
  fs.rmSync(dir, { recursive: true, force: true });
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
// DSC-003 — shutdown flush never deletes; explicit reset is separate
// ---------------------------------------------------------------------------

test("DSC-003: graceful shutdown flushes but never deletes durable state", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({});
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("telegram", "u1") });
  await t.domain.whenPersisted();
  await t.domain.shutdown();
  // The durable snapshot STILL EXISTS after shutdown.
  assert.equal(fs.existsSync(file), true, "shutdown must not delete the durable snapshot");

  // A fresh domain restores it (restart survival).
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.equal(restored.sessions, 1);

  // Explicit destructive reset is a SEPARATE administrative operation.
  await t2.domain.resetDurableState();
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("DSC-003: mutation-bound persistence survives an intermediate crash", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "continuity.json");
  const t = makeDomain({ store: createFileContinuityStore(file), persistOnMutation: true });
  const created = t.domain.createSession({ resumeMetadata: { mark: "before-crash" } });
  t.domain.bindChannel({ sessionId: created.sessionId, provenance: prov("console", "u1") });
  await t.domain.whenPersisted();
  // No graceful shutdown: simulate power loss by just creating a new domain.
  const t2 = makeDomain({ store: createFileContinuityStore(file) });
  const restored = await t2.domain.restore();
  assert.equal(restored.restored, true);
  assert.deepEqual(t2.domain.getSession(created.sessionId).resumeMetadata, { mark: "before-crash" });
  fs.rmSync(dir, { recursive: true, force: true });
});
