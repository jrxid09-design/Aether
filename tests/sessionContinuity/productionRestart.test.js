"use strict";

/**
 * WAVE 5 LANE 4 — REAL PRODUCTION COMPOSITION RESTART TESTS (repair R3).
 *
 * Proves through the FULL production path (createRuntimeHost →
 * createRuntimeCore → createDamarManagerIngressDomain):
 *   - DSC-R2-001: raw events cannot inject trusted peer evidence; the
 *     runtime-minted transport session establishes continuity.
 *   - DSC-R2-002: store ownership held through the final flush.
 *   - DSC-R2-004: awaited shared shutdown completion.
 *   - DSC-R2-005: host.channels is the ORDINARY facade (no lifecycle ops).
 *   - restart recovery, authority non-restoration.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRuntimeHost } = require("../../src/runtime/host/runtimeHost");

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

test("PRODUCTION RESTART: durable continuity across a real host composition", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-restart-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  // ------------------------------------------------------------------
  // Process/composition A.
  // ------------------------------------------------------------------
  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(hostA.health().healthy, true);

  // DSC-R2-005 (PRODUCTION): host.channels is the ORDINARY facade — no
  // lifecycle operations.
  const facadeKeys = Object.keys(hostA.channels).sort();
  assert.deepEqual(facadeKeys, ["channels", "ingest", "ingestAttachments", "render", "request", "transportSnapshot"]);
  assert.equal("restoreContinuity" in hostA.channels, false);
  assert.equal("flushContinuity" in hostA.channels, false);
  assert.equal("shutdownContinuity" in hostA.channels, false);
  assert.equal("continuityStatus" in hostA.channels, false);
  assert.equal("getSessionContinuityId" in hostA.channels, false);
  assert.equal("continuityLinker" in hostA.channels, false);

  // DSC-R2-001 (PRODUCTION): raw events cannot inject trusted evidence.
  const hostile = hostA.channels.ingest("telegram", {
    text: "klasik",
    userId: "owner-1",
    trustedPeerEvidence: "attacker-claims-trust",
    continuitySessionId: "dsc_forged000001",
    canonicalSessionId: "dsc_forged000002",
    dscId: "dsc_forged000003",
    peerKey: "attacker"
  });
  assert.equal(hostile.accepted, true, "the ordinary ses_* path works");
  assert.equal("canonicalSessionId" in hostile, false,
    "raw trustedPeerEvidence (and all trust-named fields) establish NOTHING");
  await delay(50);
  assert.equal(hostA.status().continuity.sessions, 0, "no session was minted from raw fields");

  // The RUNTIME-MINTED transport session (ses_*) establishes continuity.
  const first = hostA.channels.ingest("telegram", { text: "mulai di telegram", sessionId: "ses_tg-77123" });
  assert.equal(first.accepted, true);
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  const canonicalId = first.canonicalSessionId;
  await delay(150);
  assert.equal(fs.existsSync(stateFile), true, "mutation-bound persistence wrote the snapshot");

  // DSC-R2-004 (PRODUCTION): AWAITED graceful shutdown — durability
  // guaranteed before the caller continues.
  const shutdownResult = await hostA.shutdown("clean-restart");
  assert.equal(shutdownResult.shutDown, true);
  assert.equal(fs.existsSync(stateFile), true, "shutdown must NOT delete the durable snapshot");

  // ------------------------------------------------------------------
  // Process/composition B: FRESH production composition.
  // ------------------------------------------------------------------
  const hostB = await makeProductionHost(stateDir);
  t.after(() => { try { void hostB.shutdown("test-end"); } catch { /* idempotent */ } });
  const status = hostB.status();
  assert.equal(status.continuity.bound, true);
  assert.equal(status.continuity.restored, true);
  assert.equal(status.continuity.sessions, 1, "the pre-restart session was restored");

  // Raw events still resolve nothing after restart.
  const hostileAfter = hostB.channels.ingest("telegram", {
    text: "x", trustedPeerEvidence: "ses_tg-77123", dscId: canonicalId
  });
  assert.equal("canonicalSessionId" in hostileAfter, false,
    "raw fields still cannot resolve the restored session");

  // The matching RUNTIME-MINTED transport session resumes the restored session.
  const resumedEvent = hostB.channels.ingest("telegram", { text: "lanjut setelah restart", sessionId: "ses_tg-77123" });
  assert.equal(resumedEvent.canonicalSessionId, canonicalId,
    "matching transport-owned identity resumes the restored session");
  await delay(100);
  const completed = hostB.channels.ingest("telegram", { text: "tuntas", sessionId: "ses_tg-77123" });
  await delay(100);
  assert.equal(completed.canonicalSessionId, canonicalId);

  // Authority is NOT restored.
  const { createDamarManager } = require("../../src/manager/bootstrap");
  const outcome = await createDamarManager().handle({
    channelType: "telegram",
    channelId: "channel.telegram",
    sessionId: "ses_probe",
    continuitySessionId: canonicalId,
    correlationId: "cor-probe-restart",
    payload: { text: "coba otoritas", authenticated: true, principal: "admin", role: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED");

  const snapshotRaw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const serialized = JSON.stringify(snapshotRaw);
  for (const forbidden of ["AbortController", "capability", "principal", "authorityDecision", "token"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false);
  }

  await hostB.shutdown("test-end");
  await settle();
});

test("PRODUCTION: corrupt snapshot fails closed to a fresh domain", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-corrupt-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");
  fs.writeFileSync(stateFile, "CORRUPT-NOT-JSON{{{", "utf8");
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(host.health().healthy, true);
  const status = host.status();
  assert.equal(status.continuity.restored, false);
  assert.equal(status.continuity.sessions, 0);
  const event = host.channels.ingest("console", { text: "baru", sessionId: "ses_console-fresh" });
  assert.equal(event.accepted, true);
  assert.ok(event.canonicalSessionId.startsWith("dsc_"));
  await delay(120);
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION: restart after mutation sees the last persisted snapshot", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-mut-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  const first = hostA.channels.ingest("whatsapp", { text: "satu", sessionId: "ses_wa-99" });
  await delay(150);
  await hostA.shutdown("simulated-process-death");
  const hostB = await makeProductionHost(stateDir);
  t.after(() => { try { void hostB.shutdown("test-end"); } catch { /* idempotent */ } });
  const status = hostB.status();
  assert.equal(status.continuity.restored, true);
  assert.equal(status.continuity.sessions, 1);
  const resumed = hostB.channels.ingest("whatsapp", { text: "dua", sessionId: "ses_wa-99" });
  assert.equal(resumed.canonicalSessionId, first.canonicalSessionId);
  await hostB.shutdown("test-end");
  await settle();
});

test("PRODUCTION OWNERSHIP: second same-process host over the same durable file fails closed", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-own-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  await assert.rejects(
    () => makeProductionHost(stateDir),
    (error) => error.code === "CONTINUITY_STORE_OWNED"
  );
  await hostA.shutdown("owner-release");
  const hostB = await makeProductionHost(stateDir);
  await delay(50);
  await hostB.shutdown("second-life");
  await settle();
});

test("PRODUCTION SHUTDOWN JOIN: repeated shutdown calls all settle only after the final flush", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-join-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  host.channels.ingest("telegram", { text: "x", sessionId: "ses_join-1" });
  await delay(50);

  // Start shutdown and immediately hammer it 100 times.
  const results = [];
  for (let i = 0; i < 100; i += 1) {
    results.push(host.shutdown("join"));
  }
  const settled = await Promise.all(results);
  assert.equal(settled.length, 100);
  assert.ok(settled.every((r) => r.shutDown === true));
  // Synchronous status was available immediately (status separated from completion).
  assert.equal(results[0].idempotent, false, "first call owns the completion");
  assert.ok(results.slice(1).every((r) => r.idempotent === true),
    "subsequent calls JOIN the same completion");
  await settle();
});

test("PRODUCTION LIFECYCLE: RuntimeHost internal lifecycle restores/flushes/shuts correctly", async (t) => {
  // DSC-R2-005: the trusted lifecycle facade is RuntimeHost-internal —
  // reachable through the host composition (core.continuityLifecycle), not
  // through host.channels.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-life-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  const lifecycle = host.core.continuityLifecycle;
  assert.ok(lifecycle, "RuntimeHost core carries the private lifecycle facade");
  assert.equal(typeof lifecycle.restoreContinuity, "function");
  assert.equal(typeof lifecycle.flushContinuity, "function");
  assert.equal(typeof lifecycle.shutdownContinuity, "function");
  const flushed = await lifecycle.flushContinuity();
  assert.equal(flushed.persisted, true);
  const status = lifecycle.continuityStatus();
  assert.equal(status.bound, true);
  await host.shutdown("test-end");
  await settle();
});
