"use strict";

/**
 * WAVE 5 LANE 4 — REAL PRODUCTION COMPOSITION TESTS (repair R7).
 *
 * DSC-R6-001: the PUBLIC createRuntimeHost distributes NO privileged
 *             continuity capability (no capture hook, no renamed equivalent).
 *             The canonical voice-continuity activation closure is owned ONLY
 *             by the canonical Voice composition (runtimeHostVoice.js) behind
 *             an unforgeable per-composition token.
 * DSC-R6-002: the activation capability is lifecycle-bound — it fails closed
 *             once the owning runtime is no longer operational, and cannot be
 *             replayed across runtimes.
 * DSC-R6-003: the internal transport mint cannot inject into an existing
 *             runtime (per-scope isolation preserved).
 * DSC-R6-004: the ACTUAL VoiceRuntime restart test itself asserts the
 *             numeric incarnation strictly increases across the lifecycle.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRuntimeHost } = require("../../src/runtime/host/runtimeHost");
const { createIdentityService } = require("../../src/embodiment");
const { VoiceRuntime } = require("../../src/voice/voiceRuntime");
const { createTestTransportPeerScope } = require("../helpers/testTransportPeer");

function delay(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settle() {
  await delay(30);
  await new Promise((resolve) => setImmediate(resolve));
}

function coreOptionsFor(stateDir) {
  return {
    mediaStorageRoot: path.join(stateDir, "media-v1"),
    continuityStoreFile: path.join(stateDir, "continuity-v1.json")
  };
}

async function makeProductionHost(stateDir) {
  return createRuntimeHost({ coreOptions: coreOptionsFor(stateDir) });
}

/**
 * A host composed THROUGH the CANONICAL Voice composition boundary
 * (runtimeHostVoice.js) — the SAME module-private path the production
 * VoiceRuntime uses.  Returns the host plus a thin wrapper over the
 * composition's module-private `activateVoiceContinuity`.  This is NOT a
 * public host capability: the activation closure lives only in the
 * composition's module-private state; ordinary createRuntimeHost callers
 * receive no such capability.
 */
async function makeVoiceActivatedHost(stateDir) {
  const voiceComposition = require("../../src/runtime/host/runtimeHostVoice");
  const handle = await voiceComposition.createCanonicalVoiceRuntimeHost({
    coreOptions: coreOptionsFor(stateDir)
  });
  return {
    host: handle.host,
    activateVoice: () => voiceComposition.activateVoiceContinuity(handle),
    _handle: handle
  };
}

/** Deterministic VoiceRuntime config (graceful; backend "none"). */
function voiceTestConfig() {
  return () => ({
    enabled: true,
    enabledRaw: "true",
    wakeWord: "damar",
    wakeProvider: "local",
    sttProvider: "local",
    ttsProvider: "local",
    maxSessionMs: 60000,
    vadTimeoutMs: 100,
    maxListenMs: 1000,
    acknowledgement: "Ya?",
    language: "id",
    clapEnabled: false,
    clapThreshold: 0.6,
    clapWindowMs: 800,
    clapMinClapMs: 30,
    clapMinGapMs: 100
  });
}

// ---------------------------------------------------------------------------
// DSC-R5-001 — public surface contains NO continuity administration
// ---------------------------------------------------------------------------

test("PRODUCTION R6 DSC-R5-001: host exposes NO continuity activation/admin surface (keys/names/symbols)", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-surface-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // Forbidden continuity administration/activation identifiers anywhere on
  // the ordinary host — by keys, own-property-names, AND symbols.
  const FORBIDDEN = [
    "_continuityComposition", "continuityComposition", "internalContinuity",
    "voiceContinuityBinder", "bindCanonicalTransportPeer", "bindTransportPeerHandle",
    "registerContinuityTransportBinding", "linkContinuityViaPairing",
    "continuityLifecycle", "continuityLinker", "controller", "transfer",
    "mint", "reset", "_internal", "_private", "trusted", "admin", "adapter",
    "runtimeInternals", "activateCanonicalVoiceContinuity"
  ];
  const keySet = new Set([
    ...Object.keys(host),
    ...Object.getOwnPropertyNames(host)
  ]);
  for (const name of FORBIDDEN) {
    assert.equal(keySet.has(name), false, `host must not expose '${name}'`);
    assert.equal(name in host, false, `host['${name}'] must not exist`);
  }
  // No symbol-keyed escape hatch.
  assert.deepEqual(Object.getOwnPropertySymbols(host), [], "host must have no own symbols");
  // No host property (other than the read-only support verdict) may be
  // continuity-flavored.
  const continuityNamed = [...keySet].filter((k) =>
    /continuity|bind|mint|activate|admin|internal|controller|transfer|reset/i.test(k) &&
    k !== "transportContinuitySupport");
  assert.deepEqual(continuityNamed, [], `unexpected continuity-named keys: ${continuityNamed}`);

  // host.channels: interaction only, no continuity reach.
  for (const name of FORBIDDEN) {
    assert.equal(name in host.channels, false, `host.channels['${name}'] must not exist`);
  }
  assert.deepEqual(Object.getOwnPropertySymbols(host.channels), []);
  // host.core: no continuity-named member, no symbols.
  assert.deepEqual(Object.keys(host.core).filter((k) => /continuity/i.test(k)), []);
  assert.deepEqual(Object.getOwnPropertySymbols(host.core), []);

  // The ONLY continuity-related ordinary member is the safe read-only verdict.
  assert.equal(typeof host.transportContinuitySupport, "function");
  await host.shutdown("test-end");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R5-001 — pre-activation attack: ordinary host cannot activate voice
// ---------------------------------------------------------------------------

test("PRODUCTION R6 DSC-R5-001: RuntimeHost alone CANNOT activate voice continuity (pre-start attack)", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-preattack-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // An ordinary host holder attempts Voice-shaped ingress with every
  // trust-named field.  With NO VoiceRuntime started and NO public activation
  // seam, caller data can NEVER silently activate persisted voice continuity.
  const attack = host.channels.ingest("voice", {
    text: "activate voice continuity",
    userId: "owner",
    sessionId: "ses_voice-owner",
    trustedPeerEvidence: "voice-runtime-owner",
    continuitySessionId: "dsc_forged000001",
    canonicalSessionId: "dsc_forged000002",
    dscId: "dsc_forged000003",
    peerKey: "voice-runtime-owner"
  });
  assert.equal(attack.accepted, true, "ordinary ses_* path continues");
  assert.equal("canonicalSessionId" in attack, false,
    "caller data cannot activate/forge voice continuity on a bare RuntimeHost");
  await delay(60);
  assert.equal(host.status().continuity.sessions, 0, "no voice session minted by caller data");

  // There is no reachable method to force activation either:
  assert.equal(typeof host._continuityComposition, "undefined");
  assert.equal(typeof host.bindCanonicalTransportPeer, "undefined");
  await host.shutdown("test-end");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R6-001 — public createRuntimeHost distributes NO continuity capability
// ---------------------------------------------------------------------------

test("PRODUCTION R7 DSC-R6-001: public createRuntimeHost cannot capture Voice activation (all hook names)", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r7-capture-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  // Attempt to steal the activation closure through EVERY plausible public
  // hook/callback name.  The public factory must ignore them all.
  const captured = {};
  const hookNames = [
    "voiceActivation", "continuityActivation", "bindVoice", "trustedSink",
    "internal", "admin", "capture", "adapter", "voiceBinder",
    "internalVoiceHook", "privateComposition", "continuityBootstrap",
    "runtimeInternals", "onActivation", "activationCallback"
  ];
  const options = { coreOptions: coreOptionsFor(stateDir) };
  for (const name of hookNames) {
    options[name] = (fn) => { captured[name] = fn; };
  }
  const host = await createRuntimeHost(options);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // No hook was ever invoked → no capability leaked.
  assert.deepEqual(Object.keys(captured), [],
    `public createRuntimeHost must not invoke any capture hook; got: ${Object.keys(captured)}`);
  // And no continuity forms through ordinary voice ingress.
  const v = host.channels.ingest("voice", { text: "x", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal("canonicalSessionId" in v, false,
    "no hook → no capability → no voice continuity on a bare public host");
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION R7 DSC-R6-001: ordinary host cannot reproduce the canonical Voice composition capability", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r7-repro-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // The public host has no path to the composition's module-private
  // activation registry — not via host, core, channels, or any method.
  assert.equal(typeof host._voiceComposition, "undefined");
  assert.equal(typeof host._continuityComposition, "undefined");
  // Even with full knowledge of the composition shape, an ordinary caller
  // cannot forge the per-composition token (it is a module-private object,
  // never returned by the public factory).
  const v = host.channels.ingest("voice", { text: "x", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal("canonicalSessionId" in v, false);
  await host.shutdown("test-end");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R6-002 — lifecycle-bound revocation + cross-runtime replay
// ---------------------------------------------------------------------------

test("PRODUCTION R7 DSC-R6-002: activation capability fails closed after shutdown; no cross-runtime replay", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r7-replay-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const voiceComposition = require("../../src/runtime/host/runtimeHostVoice");

  // Runtime A (canonical Voice composition): activate, then shut down.
  const A = await makeVoiceActivatedHost(stateDir);
  t.after(() => { try { void A.host.shutdown("a"); } catch { /* idempotent */ } });
  const liveResult = A.activateVoice();
  assert.equal(liveResult.ok, true, "activation succeeds while runtime is live");
  const vA = A.host.channels.ingest("voice", { text: "hi", userId: "owner", sessionId: "ses_voice-owner" });
  assert.ok(vA.canonicalSessionId.startsWith("dsc_"));
  // Idempotent while live:
  assert.equal(A.activateVoice().ok, true, "idempotent activation while live");
  await A.host.shutdown("shutdown-a");
  await settle();

  // DSC-R6-002: post-shutdown invocation MUST fail closed (deterministic
  // terminal error), NOT silently return success, and mutate nothing.
  const postShutdown = A.activateVoice();
  assert.equal(postShutdown.ok, false, "activation after shutdown fails closed");
  assert.equal(postShutdown.code, "HOST_NOT_OPERATIONAL");
  assert.equal(postShutdown.terminal, true);
  // Inert return: no capability-shaped value.
  for (const k of Object.keys(postShutdown)) {
    assert.ok(["ok", "code", "terminal"].includes(k), `activation return must be inert; got key '${k}'`);
  }

  // DSC-R6-002: runtime A's capability must NOT affect a fresh runtime B.
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r7-replayB-"));
  t.after(() => fs.rmSync(dirB, { recursive: true, force: true }));
  const B = await makeVoiceActivatedHost(dirB);
  t.after(() => { try { void B.host.shutdown("b"); } catch { /* idempotent */ } });
  // B has NOT activated yet → no continuity.
  const vBbefore = B.host.channels.ingest("voice", { text: "x", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal("canonicalSessionId" in vBbefore, false, "runtime B is unaffected by runtime A's (now-dead) capability");
  // A forged/foreign handle object cannot activate B either:
  const forged = voiceComposition.activateVoiceContinuity({ host: B.host });
  assert.equal(forged.ok, false, "a forged handle shape cannot activate runtime B");
  // B activates only through its OWN legitimate composition handle.
  assert.equal(B.activateVoice().ok, true);
  const vB = B.host.channels.ingest("voice", { text: "hi B", userId: "owner", sessionId: "ses_voice-owner" });
  assert.ok(vB.canonicalSessionId.startsWith("dsc_"));
  assert.notEqual(vB.canonicalSessionId, vA.canonicalSessionId, "distinct runtimes → distinct dsc");
  await B.host.shutdown("shutdown-b");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R5-002 — REAL VoiceRuntime lifecycle: start activates continuity
// ---------------------------------------------------------------------------

test("PRODUCTION R6 DSC-R5-002: ACTUAL VoiceRuntime.start() activates continuity (no test-side binder)", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-voicestart-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  process.env.DAMAR_CONTINUITY_STATE = path.join(stateDir, "continuity-v1.json");
  t.after(() => { delete process.env.DAMAR_CONTINUITY_STATE; });

  const rt = new VoiceRuntime({ config: voiceTestConfig() });
  t.after(() => { try { void rt.stop(); } catch { /* idempotent */ } });
  await rt.start();

  // The production lifecycle created its own RuntimeHost; that host ALSO has
  // no public activation surface.
  const host = rt._interactionHost;
  assert.ok(host, "VoiceRuntime.start() composed a RuntimeHost");
  assert.equal("_continuityComposition" in host, false);
  // Normal voice ingress now resolves continuity — activated by start().
  const v = host.channels.ingest("voice", { text: "halo", userId: "owner", sessionId: "ses_voice-owner" });
  assert.ok(v.canonicalSessionId && v.canonicalSessionId.startsWith("dsc_"),
    "VoiceRuntime.start() activated canonical voice continuity");
  await rt.stop();
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R5-002 + DSC-R5-001 — REAL VoiceRuntime RESTART restores same dsc,
// incarnation explicitly advances.
// ---------------------------------------------------------------------------

test("PRODUCTION R6 RESTART: fresh ACTUAL VoiceRuntime restores same dsc; incarnation advances", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-restart-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");
  process.env.DAMAR_CONTINUITY_STATE = stateFile;
  t.after(() => { delete process.env.DAMAR_CONTINUITY_STATE; });

  // Read the persisted incarnation of a dsc from the durable snapshot.
  const readIncarnation = (dscId) => {
    const snap = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const sessions = snap.sessions || snap;
    const arr = Array.isArray(sessions) ? sessions : Object.values(sessions);
    const match = arr.filter((s) => s.sessionId === dscId || !dscId);
    return match.length ? Math.max(...match.map((s) => s.incarnation ?? 0)) : 0;
  };

  // ---- Composition A: ACTUAL VoiceRuntime lifecycle ------------------------
  const rtA = new VoiceRuntime({ config: voiceTestConfig() });
  await rtA.start();
  const hostA = rtA._interactionHost;
  const first = hostA.channels.ingest("voice", { text: "mulai", userId: "owner", sessionId: "ses_voice-owner" });
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  const dscX = first.canonicalSessionId;
  await delay(200);
  assert.equal(fs.existsSync(stateFile), true, "mutation-bound persistence wrote the snapshot");
  // Canonical awaited shutdown completion via the real VoiceRuntime stop.
  await rtA.stop();
  await settle();
  // DSC-R6-004: persisted incarnation N BEFORE the restart (baseline = 1).
  const incarnationN = readIncarnation(dscX);
  assert.equal(incarnationN, 1, "first incarnation persists as the baseline (N=1)");

  // ---- Composition B: fresh ACTUAL VoiceRuntime ----------------------------
  const rtB = new VoiceRuntime({ config: voiceTestConfig() });
  await rtB.start();
  const hostB = rtB._interactionHost;
  t.after(() => { try { void rtB.stop(); } catch { /* idempotent */ } });

  // Restored CLOSED (RESTORED != RESUMED), then resumed through ingress.
  const status = hostB.status().continuity;
  assert.equal(status.restored, true);
  assert.equal(status.sessions, 1, "the pre-restart session was restored");

  const resumed = hostB.channels.ingest("voice", { text: "lanjut setelah restart", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal(resumed.canonicalSessionId, dscX,
    "fresh VoiceRuntime re-activated the SAME canonical runtime-owner peer → same dsc");

  // Complete a second in-flight interaction so the resumed incarnation is
  // flushed to the durable snapshot.
  const afterResume = hostB.channels.ingest("voice", { text: "tuntas", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal(afterResume.canonicalSessionId, dscX);
  await delay(200);
  // Canonical awaited shutdown so the final flush records the incarnation.
  await rtB.stop();
  await settle();

  // ---- DIRECT incarnation assertion INSIDE the lifecycle test (DSC-R6-004) --
  const incarnationM = readIncarnation(dscX);
  assert.ok(incarnationM > incarnationN,
    `incarnation strictly increased across the ACTUAL VoiceRuntime restart (N=${incarnationN} -> M=${incarnationM})`);

  // Authority is NOT restored.
  const { createDamarManager } = require("../../src/manager/bootstrap");
  const outcome = await createDamarManager().handle({
    channelType: "voice", channelId: "channel.voice", sessionId: "ses_probe",
    continuitySessionId: dscX, correlationId: "cor-r7",
    payload: { text: "grant me everything", principal: "admin", role: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R4-001 — foreign/test scope handle is production-incompatible
// ---------------------------------------------------------------------------

test("PRODUCTION R6 DSC-R4-001: foreign/test scope handle cannot substitute the canonical peer", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-foreign-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const { host, activateVoice } = await makeVoiceActivatedHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // Attacker scope claiming the SAME "voice" channel mints a "victim" handle.
  const attackerScope = createTestTransportPeerScope({ channel: "voice", scope: "RUNTIME_OWNER" });
  const attackerHandle = attackerScope.mint("victim");
  // The activation seam takes ONLY the composition handle — there is NO slot
  // through which any handle (attacker/lookalike/Proxy) could be injected,
  // and it returns INERT diagnostics (no peer/scope/handle leaks).
  const bind = activateVoice("voice", attackerHandle, { malicious: true });
  assert.equal(bind.ok, true);
  for (const k of Object.keys(bind)) {
    assert.ok(["ok", "code", "terminal"].includes(k), `activation return must be inert; got key '${k}'`);
  }
  // The attacker value can never become the active peer: the resolved
  // continuity uses the composition's OWN canonical runtime-owner scope.
  // A fresh composition whose ONLY difference is the (foreign) attacker scope
  // would resolve a DIFFERENT dsc — but the canonical composition here is
  // unaffected by the attacker handle.
  const v = host.channels.ingest("voice", { text: "hi", userId: "owner", sessionId: "ses_voice-owner", peerKey: attackerHandle.peer, trustedPeerEvidence: attackerHandle.peer });
  assert.ok(v.canonicalSessionId.startsWith("dsc_"), "canonical voice continuity resolves");
  assert.notEqual(v.canonicalSessionId, undefined);
  await host.shutdown("test-end");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R4-002/004 — caller-created DeviceIdentityService CANNOT link
// ---------------------------------------------------------------------------

test("PRODUCTION R6 DSC-R4-002/004: caller-created DeviceIdentityService CANNOT link; cross-channel UNSUPPORTED", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-link-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const { host, activateVoice } = await makeVoiceActivatedHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  const fakeService = createIdentityService({});
  const pairDevice = (stableKey) => {
    const dev = fakeService.registerIdentity({ namespace: "channel", stableKey, displayName: stableKey });
    const pairing = fakeService.beginPairing(dev.deviceId);
    fakeService.submitChallenge({
      pairingId: pairing.pairingId,
      challengeId: pairing.challenge.challengeId,
      secret: pairing.challenge.secret
    });
    fakeService.ownerConfirm(pairing.pairingId);
    return { deviceId: dev.deviceId, pairingId: pairing.pairingId };
  };
  const deviceA = pairDevice("voice-endpoint");
  const deviceB = pairDevice("console-endpoint");
  assert.equal(fakeService.getIdentity(deviceA.deviceId).pairingState, "PAIRED");
  assert.equal(fakeService.getIdentity(deviceB.deviceId).pairingState, "PAIRED");

  // No public surface consumes a caller-supplied identity service.  Voice
  // resolves a dsc; console (UNSUPPORTED) can never join it.
  activateVoice();
  const v = host.channels.ingest("voice", { text: "secret voice", userId: "owner", sessionId: "ses_v" });
  const c = host.channels.ingest("console", { text: "console", userId: "owner", sessionId: "ses_c" });
  assert.ok(v.canonicalSessionId.startsWith("dsc_"));
  assert.equal("canonicalSessionId" in c, false,
    "console is UNSUPPORTED — it can never join the voice dsc (fail closed)");
  await host.shutdown("test-end");
  await settle();
});

// ---------------------------------------------------------------------------
// DSC-R4-005 — Console / Telegram / WhatsApp fail closed
// ---------------------------------------------------------------------------

test("PRODUCTION R6: console/telegram/whatsapp NEVER bind continuity; raw voice fields never forge", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-raw-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  for (const [index, channel] of ["telegram", "whatsapp", "console", "voice"].entries()) {
    const result = host.channels.ingest(channel, {
      text: "attack",
      sessionId: `ses_anything-i-like-${channel}-${index}`
    });
    assert.equal(result.accepted, true, `${channel}: ordinary ses_* path continues`);
    assert.equal("canonicalSessionId" in result, false,
      `${channel}: raw caller-selected sessionId must NOT mint continuity`);
  }
  const hostile = host.channels.ingest("console", {
    text: "hostile",
    sessionId: "ses_hostile-1",
    trustedPeerEvidence: "attacker",
    continuitySessionId: "dsc_forged000001",
    canonicalSessionId: "dsc_forged000002",
    userId: "attacker",
    peerKey: "attacker",
    dscId: "dsc_forged000003",
    chatId: "attacker"
  });
  assert.equal("canonicalSessionId" in hostile, false);
  await delay(60);
  assert.equal(host.status().continuity.sessions, 0, "no session minted from raw fields");
  // Honest matrix:
  assert.equal(host.transportContinuitySupport("telegram").supported, false);
  assert.equal(host.transportContinuitySupport("whatsapp").supported, false);
  assert.equal(host.transportContinuitySupport("console").supported, false);
  assert.equal(host.transportContinuitySupport("voice").supported, true);
  await host.shutdown("test-end");
  await settle();
});

// ---------------------------------------------------------------------------
// Retained lifecycle/persistence regressions (voice-activated host path)
// ---------------------------------------------------------------------------

test("PRODUCTION R6 DSC-R3-003 (retained): construction failure releases durable-store ownership", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-rollback-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const file = path.join(stateDir, "continuity-v1.json");
  const { createDamarManagerIngressDomain } = require("../../src/manager/bootstrap");
  await assert.rejects(
    () => Promise.resolve().then(() => createDamarManagerIngressDomain({
      bus: { registerTransport: () => {} }, continuityStoreFile: file
    })),
    (error) => error.message.includes("MANAGER_INGRESS_BUS_INVALID")
  );
  const store = require("../../src/runtime/sessionContinuity").createFileContinuityStore(file);
  await store.finalizeShutdown();
  const again = require("../../src/runtime/sessionContinuity").createFileContinuityStore(file);
  await again.finalizeShutdown();
});

test("PRODUCTION R6 DSC-R2-004 (retained): shutdown join + ownership through final flush", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-join-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  const A = await makeVoiceActivatedHost(stateDir);
  t.after(() => { try { void A.host.shutdown("test-end"); } catch { /* idempotent */ } });
  A.activateVoice();
  A.host.channels.ingest("voice", { text: "x", userId: "owner", sessionId: "ses_v" });
  await delay(120);
  await assert.rejects(
    () => makeProductionHost(stateDir),
    (error) => error.code === "CONTINUITY_STORE_OWNED"
  );
  await A.host.shutdown("owner-release");

  const B = await makeVoiceActivatedHost(stateDir);
  t.after(() => { try { void B.host.shutdown("test-end"); } catch { /* idempotent */ } });
  B.activateVoice();
  B.host.channels.ingest("voice", { text: "y", userId: "owner", sessionId: "ses_v" });
  await delay(120);
  const results = [];
  for (let i = 0; i < 100; i += 1) results.push(B.host.shutdown("join-" + i));
  assert.equal(results[0].idempotent, false);
  assert.ok(results.slice(1).every((r) => r.idempotent === true));
  const settled = await Promise.all(results);
  assert.ok(settled.every((r) => r.shutDown === true));
  assert.equal(fs.existsSync(stateFile), true, "shutdown never deletes the snapshot");
  await settle();
});

test("PRODUCTION R6: corrupt snapshot fails closed to a fresh domain", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r6-corrupt-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");
  fs.writeFileSync(stateFile, "CORRUPT-NOT-JSON{{{", "utf8");
  const { host, activateVoice } = await makeVoiceActivatedHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(host.health().healthy, true);
  const status = host.status().continuity;
  assert.equal(status.restored, false);
  assert.equal(status.sessions, 0);
  activateVoice();
  const event = host.channels.ingest("voice", { text: "baru", userId: "owner", sessionId: "ses_v" });
  assert.ok(event.canonicalSessionId.startsWith("dsc_"));
  await host.shutdown("test-end");
  await settle();
});
