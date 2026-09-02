"use strict";

/**
 * WAVE 5 LANE 4 — REAL PRODUCTION COMPOSITION TESTS (repair R4).
 *
 * DSC-R3-001: raw events can NEVER establish continuity identity; trusted
 * transport peer handles bound through the trusted runtime seam do.
 * DSC-R3-004: continuity lifecycle/linker are PRIVATE closure state.
 * DSC-R2-006: owner-confirmed link workflow through Device Identity & Pairing.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRuntimeHost } = require("../../src/runtime/host/runtimeHost");
const { createIdentityService } = require("../../src/embodiment");
const {
  createTransportPeerScope
} = require("../../src/runtime/sessionContinuity/transportPeer");

function delay(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settle() {
  await delay(30);
  await new Promise((resolve) => setImmediate(resolve));
}

async function makeProductionHost(stateDir) {
  return createRuntimeHost({
    coreOptions: {
      mediaStorageRoot: path.join(stateDir, "media-v1"),
      continuityStoreFile: path.join(stateDir, "continuity-v1.json")
    }
  });
}

/** The canonical voice-runtime-style trusted handle bind (mirrors the
 * production voiceRuntime.start() flow). */
function bindVoiceHandle(host) {
  const scope = createTransportPeerScope({
    channel: "voice",
    supported: true,
    scope: "RUNTIME_OWNER",
    detail: "voice runtime local-owner device scope"
  });
  return host.bindTransportPeerHandle("voice", scope.mint("voice-runtime-owner"));
}

test("PRODUCTION R3-001: raw caller-selected sessionId cannot establish continuity (all channels)", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-raw-"));
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
  // Every trust-named raw field:
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
  await delay(80);
  assert.equal(host.status().continuity.sessions, 0, "no session was minted from raw fields");
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION R3-001: trusted transport handle establishes continuity; honest support matrix", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-handle-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // Honest verdicts.
  assert.equal(host.transportContinuitySupport("telegram").supported, false);
  assert.equal(host.transportContinuitySupport("whatsapp").supported, false);
  assert.equal(host.transportContinuitySupport("console").supported, true);
  assert.equal(host.transportContinuitySupport("voice").supported, true);

  // BEFORE trusted binding: no continuity even with sessionId present.
  const before = host.channels.ingest("voice", { text: "x", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal("canonicalSessionId" in before, false);

  // Trusted bind through the runtime seam.
  const bind = bindVoiceHandle(host);
  assert.equal(bind.ok, true);
  assert.equal(bind.scope, "RUNTIME_OWNER");

  // AFTER: continuity forms; the raw sessionId value is irrelevant.
  const first = host.channels.ingest("voice", { text: "halo", userId: "owner", sessionId: "ses_anything" });
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  const second = host.channels.ingest("voice", { text: "lanjut", userId: "owner", sessionId: "ses_other-value" });
  assert.equal(second.canonicalSessionId, first.canonicalSessionId,
    "identity derives from the trusted handle, not the raw sessionId");
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION R3-001 RESTART: same trusted transport peer reconstructs WITHOUT manual identity injection", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-restart-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  // Composition A: bind trusted voice handle, establish dsc.
  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  bindVoiceHandle(hostA);
  const first = hostA.channels.ingest("voice", { text: "mulai", userId: "owner", sessionId: "ses_voice-owner" });
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  await delay(200);
  assert.equal(fs.existsSync(stateFile), true, "mutation-bound persistence wrote the snapshot");
  await hostA.shutdown("clean-restart");

  // Composition B: fresh production composition; the transport runtime
  // re-binds its OWN handle (same production flow as A — no dsc, no
  // provenance, no controller injection).
  const hostB = await makeProductionHost(stateDir);
  t.after(() => { try { void hostB.shutdown("test-end"); } catch { /* idempotent */ } });
  const status = hostB.status().continuity;
  assert.equal(status.restored, true);
  assert.equal(status.sessions, 1, "the pre-restart session was restored");
  bindVoiceHandle(hostB);
  const resumed = hostB.channels.ingest("voice", { text: "lanjut setelah restart", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal(resumed.canonicalSessionId, first.canonicalSessionId,
    "same trusted transport peer resolves the SAME dsc after restart");
  // Incarnation advanced (resume happened through the ingress).
  const completed = hostB.channels.ingest("voice", { text: "tuntas", userId: "owner", sessionId: "ses_voice-owner" });
  assert.equal(completed.canonicalSessionId, first.canonicalSessionId);

  // Authority is NOT restored.
  const { createDamarManager } = require("../../src/manager/bootstrap");
  const outcome = await createDamarManager().handle({
    channelType: "voice", channelId: "channel.voice", sessionId: "ses_probe",
    continuitySessionId: first.canonicalSessionId, correlationId: "cor-r4",
    payload: { text: "grant me everything", principal: "admin", role: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED");
  await hostB.shutdown("test-end");
  await settle();
});

test("PRODUCTION R2-006: owner-confirmed cross-channel link via Device Identity & Pairing", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-link-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // Canonical Device Identity & Pairing V1: two owner-confirmed devices.
  const identityService = createIdentityService({});
  const pairDevice = (stableKey) => {
    const dev = identityService.registerIdentity({ namespace: "channel", stableKey, displayName: stableKey });
    const pairing = identityService.beginPairing(dev.deviceId);
    identityService.submitChallenge({
      pairingId: pairing.pairingId,
      challengeId: pairing.challenge.challengeId,
      secret: pairing.challenge.secret
    });
    identityService.ownerConfirm(pairing.pairingId);
    return { deviceId: dev.deviceId, pairingId: pairing.pairingId };
  };
  const deviceA = pairDevice("voice-endpoint");
  const deviceB = pairDevice("console-endpoint");

  // Trusted registration of transport bindings for the PAIRED devices.
  const regA = host.registerContinuityTransportBinding({
    identityService, deviceId: deviceA.deviceId, channel: "voice", peer: "voice-runtime-owner"
  });
  const regB = host.registerContinuityTransportBinding({
    identityService, deviceId: deviceB.deviceId, channel: "console", peer: "console-runtime-owner"
  });
  assert.equal(regA.ok, true);
  assert.equal(regB.ok, true);

  // The owner-confirmed LINK WORKFLOW.
  const link = host.linkContinuityViaPairing({
    identityService,
    pairings: { endpointA: deviceA.pairingId, endpointB: deviceB.pairingId }
  });
  assert.equal(link.ok, true, JSON.stringify(link));

  // Bind both transport handles; both channels resolve the SAME dsc.
  bindVoiceHandle(host);
  const consoleScope = createTransportPeerScope({
    channel: "console", supported: true, scope: "RUNTIME_OWNER", detail: "console owner"
  });
  host.bindTransportPeerHandle("console", consoleScope.mint("console-runtime-owner"));
  const v = host.channels.ingest("voice", { text: "hi voice", userId: "owner", sessionId: "ses_v" });
  const c = host.channels.ingest("console", { text: "hi console", userId: "owner", sessionId: "ses_c" });
  assert.equal(c.canonicalSessionId, v.canonicalSessionId,
    "owner-confirmed link joins the two channels onto one dsc");

  // Unconfirmed pairing is rejected:
  const bad = host.linkContinuityViaPairing({
    identityService,
    pairings: { endpointA: deviceA.pairingId, endpointB: "pair-not-real" }
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "CONTINUITY_LINK_PAIRING_UNCONFIRMED");

  // Authority unchanged.
  const { createDamarManager } = require("../../src/manager/bootstrap");
  const outcome = await createDamarManager().handle({
    channelType: "console", channelId: "channel.console", sessionId: "ses_probe",
    continuitySessionId: v.canonicalSessionId, correlationId: "cor-r4-link",
    payload: { text: "authority probe", principal: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED");
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION R3-004: continuity lifecycle/linker NOT reachable from host.channels or host.core", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-private-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });

  // Ordinary facade: interaction only.
  assert.deepEqual(Object.keys(host.channels).sort(), [
    "channels", "ingest", "ingestAttachments", "render", "request", "transportSnapshot"
  ]);
  for (const forbidden of ["restoreContinuity", "flushContinuity", "shutdownContinuity", "continuityStatus", "getSessionContinuityId", "continuityLinker", "composition", "bindTransportPeer"]) {
    assert.equal(forbidden in host.channels, false, `channels.${forbidden} must not exist`);
  }
  // core: nothing continuity-named, nothing reachable.
  assert.equal(host.core.continuityLifecycle, undefined);
  assert.equal(host.core.continuityLinker, undefined);
  assert.deepEqual(Object.keys(host.core).filter((k) => k.toLowerCase().includes("continuity")), []);
  // The trusted link method exists ONLY as the explicit owner-confirmed
  // workflow on the host (requires Device Identity proof), not a raw linker:
  assert.equal(typeof host.linkContinuityViaPairing, "function");
  assert.equal(typeof host.registerContinuityTransportBinding, "function");
  // The host lifecycle still works internally (RECOVER restore ran at boot;
  // shutdown flush runs at shutdown) — verified by the restart test above.
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION R3-003: construction failure releases durable-store ownership", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-rollback-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const file = path.join(stateDir, "continuity-v1.json");
  const { createDamarManagerIngressDomain } = require("../../src/manager/bootstrap");
  // Invalid bus → construction throws AFTER store acquisition.
  await assert.rejects(
    () => Promise.resolve().then(() => createDamarManagerIngressDomain({
      bus: { registerTransport: () => {} }, continuityStoreFile: file
    })),
    (error) => error.message.includes("MANAGER_INGRESS_BUS_INVALID")
  );
  // Ownership was rolled back: the path is reacquirable.
  const store = require("../../src/runtime/sessionContinuity").createFileContinuityStore(file);
  await store.finalizeShutdown();
  const again = require("../../src/runtime/sessionContinuity").createFileContinuityStore(file);
  await again.finalizeShutdown();
});

test("PRODUCTION R2-004 (retained): shutdown join + ownership through final flush", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-join-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  // Ownership through final flush: a second same-process host fails closed.
  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  bindVoiceHandle(hostA);
  hostA.channels.ingest("voice", { text: "x", userId: "owner", sessionId: "ses_v" });
  await delay(120);
  await assert.rejects(
    () => makeProductionHost(stateDir),
    (error) => error.code === "CONTINUITY_STORE_OWNED"
  );
  await hostA.shutdown("owner-release");

  // Repeated shutdown joins the same completion.
  const hostB = await makeProductionHost(stateDir);
  t.after(() => { try { void hostB.shutdown("test-end"); } catch { /* idempotent */ } });
  bindVoiceHandle(hostB);
  hostB.channels.ingest("voice", { text: "y", userId: "owner", sessionId: "ses_v" });
  await delay(120);
  const results = [];
  for (let i = 0; i < 100; i += 1) results.push(hostB.shutdown("join-" + i));
  assert.equal(results[0].idempotent, false);
  assert.ok(results.slice(1).every((r) => r.idempotent === true));
  const settled = await Promise.all(results);
  assert.ok(settled.every((r) => r.shutDown === true));
  assert.equal(fs.existsSync(stateFile), true, "shutdown never deletes the snapshot");
  await settle();
});

test("PRODUCTION: corrupt snapshot fails closed to a fresh domain", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-r4-corrupt-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");
  fs.writeFileSync(stateFile, "CORRUPT-NOT-JSON{{{", "utf8");
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(host.health().healthy, true);
  const status = host.status().continuity;
  assert.equal(status.restored, false);
  assert.equal(status.sessions, 0);
  // The fresh domain still works via a NEW trusted bind.
  bindVoiceHandle(host);
  const event = host.channels.ingest("voice", { text: "baru", userId: "owner", sessionId: "ses_v" });
  assert.ok(event.canonicalSessionId.startsWith("dsc_"));
  await host.shutdown("test-end");
  await settle();
});
