"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (repair R4, part 2:
 * canonical ingress integration — TRANSPORT PEER HANDLE trust boundary).
 *
 * DSC-R3-001: continuity identity derives ONLY from runtime-owned
 * TransportPeerHandles minted by trusted transport peer scopes and bound
 * through the trusted runtime seam.  Raw event payload fields — sessionId,
 * ses_*, trustedPeerEvidence, continuitySessionId, canonicalSessionId,
 * userId, peerKey, dscId, chatId — are NEVER consulted.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const ib = require("../../src/runtime/interactionBus");
const { createManagerInteractionIngress } = require("../../src/runtime/interactionBus/managerIngressInternal");
const { createMediaContextAuthority } = require("../../src/manager/internal/mediaContext");
const {
  createSessionContinuity,
  createSequentialContinuityIdFactory,
  createMemoryContinuityStore
} = require("../../src/runtime/sessionContinuity");
const {
  createTransportPeerScope,
  transportContinuitySupport
} = require("../../src/runtime/sessionContinuity/transportPeer");

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

/** Trusted transport peer scope for a supported channel (test mirror of the
 * production composition's scope creation). */
function scopeFor(channel) {
  return createTransportPeerScope({
    channel,
    supported: true,
    scope: "RUNTIME_OWNER",
    detail: "test trusted scope"
  });
}

/** The trusted composition: mirrors the production root. */
function makeIngress(options = {}) {
  let now = options.now === undefined ? 1000 : options.now;
  const clock = () => now;
  const bus = ib.createInteractionBus({ clock, idFactory: ib.createSequentialIdFactory() });
  const manager = makeManager();
  let controller = null;
  const continuity = createSessionContinuity({
    clock,
    idFactory: createSequentialContinuityIdFactory(),
    store: createMemoryContinuityStore(),
    trustedLifecycle(c) { controller = c; }
  });
  const trustedContinuity = controller
    ? {
        mintPeerProvenance: controller.mintPeerProvenance,
        trustedLinkContinuity: controller.trustedLinkContinuity
      }
    : null;
  const peerScopes = {
    _scopes: new Map(),
    scope(channel) { return this._scopes.get(channel) ?? null; },
    support(channel) { return transportContinuitySupport(channel); },
    registerTestScope(channel, scope) { this._scopes.set(channel, scope); }
  };
  // Mirror the honest production matrix: only supported channels get scopes.
  for (const channel of ["console", "voice"]) {
    peerScopes.registerTestScope(channel, scopeFor(channel));
  }

  const ingress = createManagerInteractionIngress({
    bus,
    manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity,
    peerScopes,
    ...(options.historyRecorder !== undefined ? { historyRecorder: options.historyRecorder } : {}),
    ...(options.historyProvider !== undefined ? { historyProvider: options.historyProvider } : {})
  });
  return {
    bus, manager, continuity, controller, peerScopes,
    ingress, ordinary: ingress.channels, lifecycle: ingress.lifecycle,
    composition: ingress.composition,
    advance: (ms) => { now += ms; }
  };
}

// ---------------------------------------------------------------------------
// DSC-R3-001 — raw fields can NEVER establish continuity identity
// ---------------------------------------------------------------------------

test("DSC-R3-001: raw sessionId (ses_*) NEVER mints continuity — all channels", async () => {
  const { ordinary, manager } = makeIngress();
  for (const [index, channel] of ["telegram", "whatsapp", "console", "voice"].entries()) {
    // Per-channel sessionId: the bus session registry is per-transport, so each
    // channel needs its own transport-scoped ses_* (same as production).
    const result = ordinary.ingest(channel, { text: "attack", sessionId: `ses_attack-${channel}-${index}` });
    assert.equal(result.accepted, true, `${channel}: ordinary ses_* path continues`);
    assert.equal("canonicalSessionId" in result, false,
      `${channel}: raw caller-selected sessionId must NOT establish continuity`);
  }
  await tick();
  for (const call of manager.calls) {
    assert.equal("continuitySessionId" in call, false);
  }
  assert.equal(manager.calls.length, 4);
});

test("DSC-R3-001: every trust-named raw field is ignored", async () => {
  const { ordinary, manager } = makeIngress();
  const hostile = {
    text: "halo",
    sessionId: "ses_forged-session",
    trustedPeerEvidence: "attacker-claims-trust",
    continuitySessionId: "dsc_forged000001",
    canonicalSessionId: "dsc_forged000002",
    userId: "attacker",
    peerKey: "attacker",
    dscId: "dsc_forged000003",
    chatId: "attacker-chat",
    transportSessionId: "ses_forged-transport"
  };
  const result = ordinary.ingest("console", hostile);
  assert.equal(result.accepted, true, "ses_* interaction path continues");
  assert.equal("canonicalSessionId" in result, false,
    "NO continuity identity from raw event data");
  await tick();
  assert.equal("continuitySessionId" in manager.calls[0], false);
});

test("DSC-R3-001: a lookalike handle object cannot emulate a TransportPeerHandle", async () => {
  const { ordinary, composition } = makeIngress();
  const lookalike = Object.freeze({
    kind: "TransportPeerHandle",
    channel: "voice",
    peer: "voice-runtime-owner",
    scope: "RUNTIME_OWNER"
  });
  assert.throws(
    () => composition.bindTransportPeer("voice", lookalike),
    (error) => error.code === "TRANSPORT_PEER_UNTRUSTED",
    "shape-matching must not satisfy the WeakSet brand"
  );
  // And no continuity forms.
  const result = ordinary.ingest("voice", { text: "x", sessionId: "ses_voice-owner" });
  assert.equal("canonicalSessionId" in result, false);
});

// ---------------------------------------------------------------------------
// DSC-R3-001 — trusted handle binding works; honest support matrix
// ---------------------------------------------------------------------------

test("DSC-R3-001: trusted handle binding establishes continuity", async () => {
  const { ordinary, manager, composition } = makeIngress();
  const bind = composition.bindTransportPeer("voice", scopeFor("voice").mint("voice-runtime-owner"));
  assert.deepEqual(bind, { channel: "voice", peer: "voice-runtime-owner", scope: "RUNTIME_OWNER", bound: true });
  const first = ordinary.ingest("voice", { text: "halo", userId: "owner", sessionId: "ses_voice-owner" });
  assert.ok(first.canonicalSessionId.startsWith("dsc_"),
    "trusted transport peer handle establishes continuity");
  await tick();
  assert.equal(manager.calls[0].continuitySessionId, first.canonicalSessionId);
  // Same handle → same dsc.
  const second = ordinary.ingest("voice", { text: "lanjut", userId: "owner", sessionId: "ses_voice-other" });
  assert.equal(second.canonicalSessionId, first.canonicalSessionId);
});

test("DSC-R3-001: unsupported transport (telegram/whatsapp) fails closed honestly", async () => {
  const { ordinary, composition } = makeIngress();
  // Honest verdicts:
  assert.equal(transportContinuitySupport("telegram").supported, false);
  assert.equal(transportContinuitySupport("whatsapp").supported, false);
  assert.equal(transportContinuitySupport("console").supported, true);
  assert.equal(transportContinuitySupport("voice").supported, true);
  // No trusted scope exists for telegram in the composition:
  assert.equal(typeof composition.bindTransportPeer, "function");
  // Attempting to bind a telegram handle through a test scope not registered:
  const telegramScope = createTransportPeerScope({ channel: "telegram", supported: true, scope: "TEST", detail: "test" });
  assert.throws(
    () => composition.bindTransportPeer("telegram", telegramScope.mint("tg-peer")),
    (error) => error.code === "TRANSPORT_PEER_UNTRUSTED",
    "telegram has no trusted scope in the composition — fail closed"
  );
  // And raw telegram events never form continuity:
  const result = ordinary.ingest("telegram", { text: "x", userId: "77123", chatId: "77123", sessionId: "ses_tg-77123" });
  assert.equal(result.accepted, true, "ses_* interaction path continues");
  assert.equal("canonicalSessionId" in result, false, "no continuity for unsupported transport");
});

test("DSC-R3-001: per-transport distinctness (voice X != console X)", async () => {
  const { ordinary, composition, continuity } = makeIngress();
  composition.bindTransportPeer("voice", scopeFor("voice").mint("shared-owner"));
  composition.bindTransportPeer("console", scopeFor("console").mint("shared-owner"));
  const v = ordinary.ingest("voice", { text: "hi", sessionId: "ses_v" });
  const c = ordinary.ingest("console", { text: "hi", sessionId: "ses_c" });
  await tick();
  assert.notEqual(v.canonicalSessionId, c.canonicalSessionId,
    "same peer value on different transports stays distinct");
  assert.equal(continuity.snapshotDiagnostics().sessions, 2);
});

test("DSC-R3-001: voice identity is RUNTIME/DEVICE scoped, not human", async () => {
  const { ordinary, composition } = makeIngress();
  composition.bindTransportPeer("voice", scopeFor("voice").mint("voice-runtime-owner"));
  // Two different physical speakers (different userId) share the device scope:
  const a = ordinary.ingest("voice", { text: "speaker one", userId: "alice", sessionId: "ses_v1" });
  const b = ordinary.ingest("voice", { text: "speaker two", userId: "bob", sessionId: "ses_v2" });
  assert.equal(a.canonicalSessionId, b.canonicalSessionId,
    "voice continuity is DEVICE/RUNTIME-SCOPED by design (documented, not human identity)");
  const verdict = transportContinuitySupport("voice");
  assert.equal(verdict.scope, "RUNTIME_OWNER");
  assert.match(verdict.detail, /DEVICE\/RUNTIME-SCOPED/i);
});

// ---------------------------------------------------------------------------
// DSC-R2-005 — facade split (retained)
// ---------------------------------------------------------------------------

test("DSC-R2-005 (retained): ordinary channel facade has NO lifecycle operations", () => {
  const { ordinary } = makeIngress();
  assert.deepEqual(Object.keys(ordinary).sort(), [
    "channels", "ingest", "ingestAttachments", "render", "request", "transportSnapshot"
  ].sort());
});

test("DSC-R2-005 (retained): the private lifecycle facade performs restore/flush/shutdown", async () => {
  const { lifecycle } = makeIngress();
  const restored = await lifecycle.restoreContinuity();
  assert.equal(restored.restored, true);
  const flushed = await lifecycle.flushContinuity();
  assert.equal(flushed.persisted, true);
  const shutdown = await lifecycle.shutdownContinuity();
  assert.equal(shutdown.shutdown, true);
});

// ---------------------------------------------------------------------------
// DSC-R2-006 + DSC-R3-005 — trusted link workflow + conflict semantics
// ---------------------------------------------------------------------------

test("DSC-R3-005: link conflict FAILS CLOSED without silent transfer", () => {
  const { continuity, controller } = makeIngress();
  const provA = controller.mintPeerProvenance(scopeFor("voice").mint("owner-1"));
  const provC = controller.mintPeerProvenance(scopeFor("console").mint("owner-3"));
  const s1 = continuity.createSession({});
  continuity.bindChannel({ sessionId: s1.sessionId, provenance: provA });
  const s2 = continuity.createSession({});
  continuity.bindChannel({ sessionId: s2.sessionId, provenance: provC });
  // Both endpoints bound to DIFFERENT live sessions → typed conflict.
  assert.throws(
    () => controller.trustedLinkContinuity({ provenanceA: provA, provenanceB: provC }),
    (error) => {
      assert.equal(error.code, "LINK_CONFLICT");
      assert.equal(error.details.endpointA.boundSessionId, s1.sessionId);
      assert.equal(error.details.endpointB.boundSessionId, s2.sessionId);
      return true;
    }
  );
  // Original bindings unchanged.
  assert.equal(continuity.resolveChannel({ provenance: provA }).sessionId, s1.sessionId);
  assert.equal(continuity.resolveChannel({ provenance: provC }).sessionId, s2.sessionId);
});

test("DSC-R2-006: link requires TRUSTED handles for BOTH endpoints", () => {
  const { continuity, controller } = makeIngress();
  const handle = scopeFor("voice").mint("owner-1");
  const prov = controller.mintPeerProvenance(handle);
  assert.throws(
    () => controller.mintPeerProvenance({ kind: "TransportPeerHandle", channel: "x", peer: "y" }),
    (error) => error.code === "PROVENANCE_UNTRUSTED"
  );
  assert.throws(
    () => controller.trustedLinkContinuity({ provenanceA: prov, provenanceB: { kind: "PeerProvenance" } }),
    (error) => error.code === "PROVENANCE_UNTRUSTED"
  );
});

test("DSC-R2-006: linking one bound + one unbound endpoint joins the bound session", () => {
  const { continuity, controller } = makeIngress();
  const provA = controller.mintPeerProvenance(scopeFor("voice").mint("owner-1"));
  const provB = controller.mintPeerProvenance(scopeFor("console").mint("owner-2"));
  const s1 = continuity.createSession({});
  continuity.bindChannel({ sessionId: s1.sessionId, provenance: provA });
  const link = controller.trustedLinkContinuity({ provenanceA: provA, provenanceB: provB });
  assert.equal(link.sessionId, s1.sessionId, "unbound endpoint joins the bound session");
  assert.equal(continuity.resolveChannel({ provenance: provB }).sessionId, s1.sessionId);
  // Idempotent re-link.
  const again = controller.trustedLinkContinuity({ provenanceA: provA, provenanceB: provB });
  assert.equal(again.idempotent, true);
});

// ---------------------------------------------------------------------------
// Retained: admission-incarnation race (real ingress path)
// ---------------------------------------------------------------------------

test("retained: admission-incarnation race (old completion after resume)", async () => {
  let releaseFirst = null;
  const manager = {
    calls: [],
    async handle(input) {
      this.calls.push(input);
      if (this.calls.length === 1) {
        await new Promise((resolve) => { releaseFirst = resolve; });
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
  const peerScopes = {
    scope: (ch) => (ch === "voice" ? scopeFor("voice") : null),
    support: transportContinuitySupport
  };
  const ingress = createManagerInteractionIngress({
    bus, manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity: {
      mintPeerProvenance: controller.mintPeerProvenance,
      trustedLinkContinuity: controller.trustedLinkContinuity
    },
    peerScopes,
    historyRecorder: null
  });
  ingress.composition.bindTransportPeer("voice", scopeFor("voice").mint("race-owner"));
  const old = ingress.channels.ingest("voice", { text: "pekerjaan lama", sessionId: "ses_race" });
  await tick();
  const admissionIncarnation = continuity.currentIncarnation(old.canonicalSessionId);
  continuity.resumeSession({ sessionId: old.canonicalSessionId });
  releaseFirst();
  await tick(); await tick(); await tick();
  assert.equal(continuity.getTerminalInteraction(old.interactionId), null,
    "old work must not record terminal state in the new incarnation");
  assert.throws(
    () => continuity.commitTerminalOutcome({
      sessionId: old.canonicalSessionId, interactionId: old.interactionId,
      generation: admissionIncarnation, state: "COMPLETED"
    }),
    (error) => error.code === "STALE_GENERATION"
  );
  const fresh = ingress.channels.ingest("voice", { text: "baru", sessionId: "ses_race2" });
  await tick(); await tick();
  assert.ok(continuity.getTerminalInteraction(fresh.interactionId),
    "current-incarnation work records its terminal outcome");
});

test("retained: without continuity injection, ingress behaves as before", async () => {
  const bus = ib.createInteractionBus({ clock: () => 1000, idFactory: ib.createSequentialIdFactory() });
  const manager = makeManager();
  const ingress = createManagerInteractionIngress({
    bus, manager, mediaContextMint: createMediaContextAuthority().mint
  });
  const result = ingress.channels.ingest("console", { text: "klasik", userId: "u" });
  assert.equal(result.accepted, true);
  assert.equal("canonicalSessionId" in result, false);
  await tick();
  assert.equal(manager.calls.length, 1);
  assert.equal("continuitySessionId" in manager.calls[0], false);
});

test("retained: voice interaction through canonical ingress (trusted handle)", async () => {
  const { ordinary, manager, composition } = makeIngress();
  composition.bindTransportPeer("voice", scopeFor("voice").mint("voice-runtime-owner"));
  const result = await ordinary.request("voice", {
    text: "jam berapa sekarang", userId: "owner", sessionId: "ses_voice-owner"
  });
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "voice");
  assert.equal(result.detail, "echo:jam berapa sekarang");
});
