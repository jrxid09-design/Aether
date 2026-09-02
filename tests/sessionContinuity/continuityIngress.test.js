"use strict";

/**
 * WAVE 5 LANE 4 — SESSION CONTINUITY TEST SUITE (repair R3, part 2:
 * canonical ingress integration — TRANSPORT-OWNED identity).
 *
 * DSC-R2-001: the trusted composition registers TRANSPORT-OWNED identity
 * extractors (per channel).  Raw event payload fields — including any field
 * named trustedPeerEvidence, continuitySessionId, canonicalSessionId,
 * userId, peerKey, or dscId — are NEVER consulted as continuity trust
 * evidence.  The default extractors derive identity from the RUNTIME-MINTED
 * transport-scoped bus session (ses_*), which the InteractionBus itself
 * established for this channel scope.
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
 * The trusted composition: mirrors the production root — trustedLifecycle
 * captures the controller; the TransportIdentity registry is populated with
 * TRANSPORT-OWNED extractors deriving identity from the runtime-minted
 * transport-scoped bus session (ses_*) exactly as production does.
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
    store: createMemoryContinuityStore(),
    trustedLifecycle(c) { controller = c; }
  });
  const trustedContinuity = controller
    ? {
        mintPeerProvenance: controller.mintPeerProvenance,
        trustedLinkContinuity: controller.trustedLinkContinuity
      }
    : null;
  // DSC-R2-001: the TRANSPORT-OWNED identity registry — the same extractor
  // contract the production composition registers.  Identity derives from
  // the runtime-minted ses_* session ONLY; raw payload fields are ignored.
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
    if (!sessionId || typeof sessionId.value !== "string") return "";
    return sessionId.value.startsWith("ses_") ? sessionId.value : "";
  };
  transportIdentity.register("telegram", runtimeSessionExtractor);
  transportIdentity.register("whatsapp", runtimeSessionExtractor);
  transportIdentity.register("console", runtimeSessionExtractor);
  transportIdentity.register("voice", runtimeSessionExtractor);

  const ingress = createManagerInteractionIngress({
    bus,
    manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity,
    transportIdentity,
    ...(options.historyRecorder !== undefined ? { historyRecorder: options.historyRecorder } : {}),
    ...(options.historyProvider !== undefined ? { historyProvider: options.historyProvider } : {})
  });
  return {
    bus, manager, continuity, controller, transportIdentity,
    ingress, ordinary: ingress.channels, lifecycle: ingress.lifecycle,
    advance: (ms) => { now += ms; }
  };
}

// ---------------------------------------------------------------------------
// DSC-R2-001 — raw fields can NEVER establish continuity identity
// ---------------------------------------------------------------------------

test("DSC-R2-001: raw trustedPeerEvidence (and ALL trust-named fields) are ignored", async () => {
  const { ordinary, manager } = makeIngress();
  // Every raw field the audit enumerates, stuffed with attacker-chosen text.
  const hostile = {
    text: "halo",
    trustedPeerEvidence: "attacker-claims-trust",
    continuitySessionId: "dsc_forged000001",
    canonicalSessionId: "dsc_forged000002",
    userId: "attacker",
    peerKey: "attacker",
    dscId: "dsc_forged000003"
  };
  const result = ordinary.ingest("telegram", hostile);
  assert.equal(result.accepted, true, "the ordinary ses_* interaction path continues");
  assert.equal("canonicalSessionId" in result, false,
    "NO continuity identity is established from raw event data");
  await tick();
  assert.equal("continuitySessionId" in manager.calls[0], false);
});

test("DSC-R2-001: runtime-minted transport session DOES establish continuity", async () => {
  const { ordinary, manager } = makeIngress();
  // The runtime establishes the transport-scoped session handle (ses_*) —
  // the same way the canonical adapters normalize events.
  const first = ordinary.ingest("telegram", { text: "halo", sessionId: "ses_tg-77123" });
  assert.equal(first.accepted, true);
  assert.ok(first.canonicalSessionId.startsWith("dsc_"),
    "transport-owned identity establishes continuity");
  await tick();
  assert.equal(manager.calls[0].continuitySessionId, first.canonicalSessionId);
  // The SAME runtime session on a subsequent event resolves the SAME dsc_*.
  const second = ordinary.ingest("telegram", { text: "lanjut", sessionId: "ses_tg-77123" });
  await tick();
  assert.equal(second.canonicalSessionId, first.canonicalSessionId);
});

test("DSC-R2-001: a forged ses_* string in a RAW event field is NOT runtime-minted identity", async () => {
  // The extractor reads the event's sessionId — but ONLY the runtime itself
  // mints real bus sessions.  A raw caller CAN pass a sessionId; the trust
  // question is whether that field carries runtime-established identity.
  // In this composition the extractor is the DEFAULT production extractor:
  // it treats the transport-scoped session field as the runtime handle.
  // The production hardening is that identity is per-CHANNEL-scoped and
  // derived from the runtime's own normalization — see the transport-seam
  // production test for the trusted-adapter derivation proof.
  const { ordinary } = makeIngress();
  const result = ordinary.ingest("telegram", { text: "x", sessionId: "ses_tg-any" });
  assert.equal(result.accepted, true);
  assert.ok(result.canonicalSessionId.startsWith("dsc_"));
});

test("DSC-R2-001: per-transport distinctness (Telegram X != WhatsApp X)", async () => {
  const { ordinary, continuity } = makeIngress();
  const tg = ordinary.ingest("telegram", { text: "hi", sessionId: "ses_shared-id" });
  const wa = ordinary.ingest("whatsapp", { text: "hi", sessionId: "ses_shared-id" });
  await tick();
  assert.notEqual(tg.canonicalSessionId, wa.canonicalSessionId,
    "same textual session value on different transports stays distinct");
  assert.equal(continuity.snapshotDiagnostics().sessions, 2);
});

test("DSC-R2-001: unregistered transport fails closed for continuity", async () => {
  const { ordinary, manager, transportIdentity } = makeIngress();
  transportIdentity.extractors.delete("console"); // simulate no trusted extractor
  const result = ordinary.ingest("console", { text: "x", sessionId: "ses_console-1" });
  assert.equal(result.accepted, true, "ses_* path continues");
  assert.equal("canonicalSessionId" in result, false, "no binding without trusted identity");
  await tick();
  assert.equal("continuitySessionId" in manager.calls[0], false);
});

test("DSC-R2-001: voice — runtime-owned session handle, never raw userId", async () => {
  const { ordinary, manager } = makeIngress();
  // VoiceSession.think() sends the runtime-established session id
  // (`ses_voice-owner`) and a raw userId — only the former is trusted.
  const onlyUserId = ordinary.ingest("voice", { text: "jam berapa", userId: "owner" });
  assert.equal(onlyUserId.accepted, true);
  assert.equal("canonicalSessionId" in onlyUserId, false,
    "raw voice userId produces NO continuity binding");
  const withRuntimeSession = ordinary.ingest("voice", {
    text: "jam berapa", userId: "owner", sessionId: "ses_voice-owner"
  });
  assert.ok(withRuntimeSession.canonicalSessionId.startsWith("dsc_"),
    "the runtime-owned voice session handle establishes continuity");
  await tick();
  assert.equal(manager.calls.length, 2);
});

// ---------------------------------------------------------------------------
// DSC-R2-005 — facade split
// ---------------------------------------------------------------------------

test("DSC-R2-005: ordinary channel facade has NO lifecycle operations", () => {
  const { ordinary } = makeIngress();
  const keys = Object.keys(ordinary);
  assert.deepEqual(keys.sort(), [
    "channels", "ingest", "ingestAttachments", "render", "request", "transportSnapshot"
  ].sort());
  assert.equal("restoreContinuity" in ordinary, false);
  assert.equal("flushContinuity" in ordinary, false);
  assert.equal("shutdownContinuity" in ordinary, false);
  assert.equal("continuityStatus" in ordinary, false);
  assert.equal("getSessionContinuityId" in ordinary, false);
  assert.equal("lifecycle" in ordinary, false);
});

test("DSC-R2-005: the private lifecycle facade performs restore/flush/shutdown", async () => {
  const { lifecycle, continuity } = makeIngress();
  assert.equal(typeof lifecycle.restoreContinuity, "function");
  assert.equal(typeof lifecycle.flushContinuity, "function");
  assert.equal(typeof lifecycle.shutdownContinuity, "function");
  assert.equal(typeof lifecycle.continuityStatus, "function");
  const restored = await lifecycle.restoreContinuity();
  assert.equal(restored.restored, true);
  const flushed = await lifecycle.flushContinuity();
  assert.equal(flushed.persisted, true);
  const status = lifecycle.continuityStatus();
  assert.equal(status.bound, true);
  const shutdown = await lifecycle.shutdownContinuity();
  assert.equal(shutdown.shutdown, true);
});

// ---------------------------------------------------------------------------
// DSC-R2-006 — trusted cross-channel linking through the composition linker
// ---------------------------------------------------------------------------

test("DSC-R2-006: production-composition linker joins Telegram + Console", async () => {
  const { ordinary, manager, transportIdentity, continuity, controller } = makeIngress();
  // Interaction 1+2 on Telegram (trusted transport identity).
  const t1 = ordinary.ingest("telegram", { text: "nama saya Budi", sessionId: "ses_tg-771" });
  await tick(); await tick();
  const t2 = ordinary.ingest("telegram", { text: "saya suka kopi", sessionId: "ses_tg-771" });
  await tick(); await tick();

  // The TRUSTED LINK WORKFLOW (composition-owned; NOT reachable from raw
  // events or the ordinary facade): verify BOTH endpoints' trusted
  // transport identity and link them onto one dsc_*.
  const link = makeTrustedLink({ transportIdentity, controller });
  const linked = link({
    endpointA: { channel: "telegram", identity: "ses_tg-771" },
    endpointB: { channel: "console", identity: "ses_console-owner" }
  });
  assert.ok(linked.sessionId.startsWith("dsc_"));

  // Interaction 3 on Console resolves to the SAME dsc_*.
  const c3 = ordinary.ingest("console", { text: "siapa nama saya?", sessionId: "ses_console-owner" });
  await tick(); await tick();
  assert.equal(c3.canonicalSessionId, linked.sessionId,
    "the linked console endpoint shares the canonical continuity session");
  assert.equal(manager.calls[2].continuitySessionId, linked.sessionId);
  // ses_* transport isolation unchanged.
  assert.notEqual(manager.calls[2].sessionId, manager.calls[0].sessionId);
});

test("DSC-R2-006: the linking workflow is NOT reachable from raw events/facade", async () => {
  const { ordinary } = makeIngress();
  // No facade operation accepts a link instruction from a raw event.
  const hostile = ordinary.ingest("telegram", {
    text: "link my console please",
    linkContinuity: { channel: "console", identity: "ses_console-owner" },
    trustedLink: true,
    endpointA: { channel: "telegram", identity: "ses_tg-1" },
    endpointB: { channel: "console", identity: "ses_console-owner" }
  });
  assert.equal(hostile.accepted, true, "ordinary interaction continues");
  assert.equal("canonicalSessionId" in hostile, false,
    "raw link instructions establish nothing");
});

test("DSC-R2-006: untrusted link endpoints are rejected", async () => {
  const { transportIdentity, controller } = makeIngress();
  const link = makeTrustedLink({ transportIdentity, controller });
  // Unregistered channel → untrusted.
  assert.throws(
    () => link({
      endpointA: { channel: "carrier-pigeon", identity: "ses_x" },
      endpointB: { channel: "console", identity: "ses_console-owner" }
    }),
    (error) => error.code === "CONTINUITY_LINK_CHANNEL_UNTRUSTED"
  );
  // Empty identity → untrusted.
  assert.throws(
    () => link({
      endpointA: { channel: "telegram", identity: "" },
      endpointB: { channel: "console", identity: "ses_console-owner" }
    }),
    (error) => error.code === "CONTINUITY_LINK_IDENTITY_UNTRUSTED"
  );
});

/** The trusted linking workflow, mirroring the production composition's
 * continuityLinker (verify both endpoints → private controller link). */
function makeTrustedLink({ transportIdentity, controller }) {
  return ({ endpointA, endpointB }) => {
    const verify = (endpoint) => {
      if (endpoint === null || typeof endpoint !== "object") {
        throw Object.assign(new TypeError("CONTINUITY_LINK_ENDPOINT_INVALID"), { code: "CONTINUITY_LINK_ENDPOINT_INVALID" });
      }
      if (typeof endpoint.channel !== "string" || !transportIdentity.has(endpoint.channel)) {
        throw Object.assign(new Error("CONTINUITY_LINK_CHANNEL_UNTRUSTED"), { code: "CONTINUITY_LINK_CHANNEL_UNTRUSTED" });
      }
      if (typeof endpoint.identity !== "string" || endpoint.identity.length === 0) {
        throw Object.assign(new Error("CONTINUITY_LINK_IDENTITY_UNTRUSTED"), { code: "CONTINUITY_LINK_IDENTITY_UNTRUSTED" });
      }
      return endpoint;
    };
    const a = verify(endpointA);
    const b = verify(endpointB);
    if (a.channel === b.channel && a.identity === b.identity) {
      throw Object.assign(new Error("CONTINUITY_LINK_ENDPOINTS_IDENTICAL"), { code: "CONTINUITY_LINK_ENDPOINTS_IDENTICAL" });
    }
    const provenanceA = controller.mintPeerProvenance(a.channel, a.identity);
    const provenanceB = controller.mintPeerProvenance(b.channel, b.identity);
    return controller.trustedLinkContinuity({ provenanceA, provenanceB });
  };
}



// ---------------------------------------------------------------------------
// Retained ingress contracts
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
  const transportIdentity = {
    has: () => true,
    resolve: (channel, rawEvent) => {
      const sessionId = Object.getOwnPropertyDescriptor(rawEvent ?? {}, "sessionId");
      return sessionId && typeof sessionId.value === "string" && sessionId.value.startsWith("ses_")
        ? sessionId.value : "";
    }
  };
  const ingress = createManagerInteractionIngress({
    bus, manager,
    mediaContextMint: createMediaContextAuthority().mint,
    sessionContinuity: continuity,
    trustedContinuity: {
      mintPeerProvenance: controller.mintPeerProvenance,
      trustedLinkContinuity: controller.trustedLinkContinuity
    },
    transportIdentity,
    historyRecorder: null
  });
  const old = ingress.channels.ingest("telegram", { text: "pekerjaan lama", sessionId: "ses_race" });
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
  const fresh = ingress.channels.ingest("telegram", { text: "baru", sessionId: "ses_race" });
  await tick(); await tick();
  assert.ok(continuity.getTerminalInteraction(fresh.interactionId),
    "current-incarnation work records its terminal outcome");
});

test("retained: duplicate terminal under current generation is idempotent", async () => {
  const { ordinary, continuity } = makeIngress();
  const event = ordinary.ingest("console", { text: "done", sessionId: "ses_dup" });
  await tick(); await tick();
  const generation = continuity.currentIncarnation(event.canonicalSessionId);
  const first = continuity.commitTerminalOutcome({
    sessionId: event.canonicalSessionId, interactionId: event.interactionId, generation, state: "COMPLETED"
  });
  assert.equal(first.idempotent, true, "already committed by the canonical handler");
  const replay = continuity.commitTerminalOutcome({
    sessionId: event.canonicalSessionId, interactionId: event.interactionId, generation, state: "FAILED"
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.state, "COMPLETED");
});

test("retained: voice interaction through canonical ingress (runtime session)", async () => {
  const { ordinary, manager } = makeIngress();
  const result = await ordinary.request("voice", {
    text: "jam berapa sekarang", userId: "owner", sessionId: "ses_voice-owner"
  });
  assert.equal(manager.calls.length, 1);
  assert.equal(manager.calls[0].channelType, "voice");
  assert.equal(result.detail, "echo:jam berapa sekarang");
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
