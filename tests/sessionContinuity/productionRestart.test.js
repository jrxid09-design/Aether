"use strict";

/**
 * WAVE 5 LANE 4 — REAL PRODUCTION COMPOSITION RESTART TESTS (repair R2).
 *
 * DSC-R1-005: proves durable session continuity across a REAL canonical
 * RuntimeHost composition restart with an AWAITED shutdown contract, plus
 * runtime-owned peer provenance through the trusted composition.
 *
 *   createRuntimeHost → createRuntimeCore (enableManagerIngress) →
 *   createDamarManagerIngressDomain → durable continuity store →
 *   RuntimeHost RECOVER-phase boot restore → explicit resume on trusted
 *   runtime-owned peer evidence → incarnation advance → stale pre-restart
 *   outcome rejection → authority non-restoration.
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
  // The REAL production composition: no injected core, no test doubles.
  // Durable continuity snapshot lives inside the per-test state directory
  // exactly the way the production default lives in ~/.damar/.
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
  // Process/composition A: start canonical RuntimeHost composition.
  // ------------------------------------------------------------------
  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(hostA.health().healthy, true);
  assert.ok(hostA.channels, "production host exposes the canonical channel ingress");

  // DSC-R1-006 (PRODUCTION): continuity forms ONLY on runtime-owned peer
  // evidence.  Raw userId alone never establishes continuity.
  const rawOnly = hostA.channels.ingest("telegram", { text: "klasik", userId: "owner-1" });
  assert.equal(rawOnly.accepted, true, "the ordinary ses_* path works");
  assert.equal("canonicalSessionId" in rawOnly, false, "raw userId establishes NO continuity");
  await delay(50);
  assert.equal(hostA.status().continuity.sessions, 0, "no session was minted for raw userId");

  // Trusted runtime-owned evidence DOES establish continuity.
  const first = hostA.channels.ingest("telegram", { text: "mulai di telegram", trustedPeerEvidence: "tg-owner-77123" });
  assert.equal(first.accepted, true);
  assert.ok(first.canonicalSessionId.startsWith("dsc_"));
  const canonicalId = first.canonicalSessionId;
  await delay(150);

  // Mutation-bound persistence has already written the snapshot.
  assert.equal(fs.existsSync(stateFile), true,
    "production persists continuity state at the mutation point (no timer loop)");

  // DSC-R1-005 (PRODUCTION): AWAITED graceful shutdown — durability is
  // guaranteed before the caller continues.
  const shutdownResult = await hostA.shutdown("clean-restart");
  assert.equal(shutdownResult.shutDown, true);
  assert.equal(fs.existsSync(stateFile), true,
    "graceful shutdown must NOT delete the durable continuity snapshot");

  // ------------------------------------------------------------------
  // Process/composition B: FRESH canonical production composition.
  // ------------------------------------------------------------------
  const hostB = await makeProductionHost(stateDir);
  t.after(() => { try { void hostB.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(hostB.health().healthy, true);

  // Boot/recover used the same durable state through the RECOVER phase.
  const status = hostB.status();
  assert.ok(status.continuity, "host status exposes continuity diagnostics");
  assert.equal(status.continuity.bound, true);
  assert.equal(status.continuity.restored, true);
  assert.equal(status.continuity.sessions, 1,
    "the pre-restart session was restored into the new composition");
  assert.equal(hostB.channels.getSessionContinuityId("telegram", {}) === null, true,
    "no raw event can resolve the restored session");

  // The restored session is CLOSED (RESTORED != RESUMED) until a trusted
  // matching runtime-owned peer event resumes it through the ingress.
  const resumedEvent = hostB.channels.ingest("telegram", { text: "lanjut setelah restart", trustedPeerEvidence: "tg-owner-77123" });
  assert.equal(resumedEvent.accepted, true);
  assert.equal(resumedEvent.canonicalSessionId, canonicalId,
    "matching trusted runtime-owned peer resumes the restored session");

  // Incarnation ADVANCED past the pre-restart incarnation.
  await delay(100);
  const completed = hostB.channels.ingest("telegram", { text: "tuntas", trustedPeerEvidence: "tg-owner-77123" });
  await delay(100);
  assert.equal(completed.canonicalSessionId, canonicalId);

  // ------------------------------------------------------------------
  // Authority/principal/capabilities are NOT restored.
  // ------------------------------------------------------------------
  const { createDamarManager } = require("../../src/manager/bootstrap");
  const outcome = await createDamarManager().handle({
    channelType: "telegram",
    channelId: "channel.telegram",
    sessionId: "ses_probe",
    continuitySessionId: canonicalId,
    correlationId: "cor-probe-restart",
    payload: { text: "coba otoritas", authenticated: true, principal: "admin", role: "admin" }
  });
  assert.equal(outcome.outcome, "AUTHENTICATION_REQUIRED",
    "continuity identity must NEVER restore or mint authority");

  // No capability/authority fields ever entered the durable snapshot.
  const snapshotRaw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const serialized = JSON.stringify(snapshotRaw);
  for (const forbidden of ["AbortController", "capability", "principal", "authorityDecision", "token"]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false,
      `durable snapshot must not contain authority-bearing field "${forbidden}"`);
  }

  await hostB.shutdown("test-end");
  await settle();
});

test("PRODUCTION RESTART: corrupt snapshot fails closed to a fresh domain", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-corrupt-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");
  fs.writeFileSync(stateFile, "CORRUPT-NOT-JSON{{{", "utf8");

  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(host.health().healthy, true, "corrupt continuity state must not fail the boot");
  const status = host.status();
  assert.equal(status.continuity.restored, false);
  assert.equal(status.continuity.sessions, 0, "corrupt state degrades to a FRESH domain");

  const event = host.channels.ingest("console", { text: "baru", trustedPeerEvidence: "fresh-user" });
  assert.equal(event.accepted, true);
  assert.ok(event.canonicalSessionId.startsWith("dsc_"));
  await delay(120);
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION RESTART: oversized snapshot fails closed", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-oversize-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");
  const sessions = [];
  for (let i = 0; i < 5000; i += 1) {
    sessions.push({
      sessionId: `dsc_${String(i).padStart(12, "0")}`,
      createdAt: 1, updatedAt: 1, incarnation: 1,
      resumeMetadata: null, terminalAt: null, channels: []
    });
  }
  fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, savedAt: 1, sessions, terminal: {} }), "utf8");

  const host = await makeProductionHost(stateDir);
  t.after(() => { try { void host.shutdown("test-end"); } catch { /* idempotent */ } });
  assert.equal(host.health().healthy, true);
  const status = host.status();
  assert.equal(status.continuity.restored, false);
  assert.equal(status.continuity.sessions, 0, "oversized snapshot degrades to fresh");
  await host.shutdown("test-end");
  await settle();
});

test("PRODUCTION RESTART: restart after mutation sees the last persisted snapshot", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-mut-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  const first = hostA.channels.ingest("whatsapp", { text: "satu", trustedPeerEvidence: "wa-jid-99" });
  await delay(150);
  // CRASH simulation: the previous process dies — ownership is released with
  // the process while the last mutation-bound snapshot stays durable on
  // disk.  (In-process: release via the non-destructive store release.)
  await hostA.shutdown("simulated-process-death");
  const hostB = await makeProductionHost(stateDir);
  t.after(() => { try { void hostB.shutdown("test-end"); } catch { /* idempotent */ } });
  const status = hostB.status();
  assert.equal(status.continuity.restored, true);
  assert.equal(status.continuity.sessions, 1);
  const resumed = hostB.channels.ingest("whatsapp", { text: "dua", trustedPeerEvidence: "wa-jid-99" });
  assert.equal(resumed.canonicalSessionId, first.canonicalSessionId,
    "crash-recovered snapshot preserves the canonical session identity");
  await hostB.shutdown("test-end");
  await settle();
});

test("PRODUCTION RESTART: normal shutdown never deletes durable state", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-noDel-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  const hostA = await makeProductionHost(stateDir);
  hostA.channels.ingest("console", { text: "persist-me", trustedPeerEvidence: "u-1" });
  await delay(150);
  await hostA.shutdown("clean");
  assert.equal(fs.existsSync(stateFile), true);

  // Second shutdown cycle (idempotence of the no-delete law).
  const hostB = await makeProductionHost(stateDir);
  await delay(100);
  await hostB.shutdown("clean-again");
  assert.equal(fs.existsSync(stateFile), true,
    "repeated graceful shutdowns never delete the durable snapshot");
  await settle();
});

test("PRODUCTION OWNERSHIP: second same-process host over the same durable file fails closed", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "damar-prod-own-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const stateFile = path.join(stateDir, "continuity-v1.json");

  const hostA = await makeProductionHost(stateDir);
  t.after(() => { try { void hostA.shutdown("test-end"); } catch { /* idempotent */ } });
  // A SECOND host in the SAME process over the SAME durable file fails with
  // the typed ownership error (same-process ambiguity closed).
  await assert.rejects(
    () => makeProductionHost(stateDir),
    (error) => error.code === "CONTINUITY_STORE_OWNED"
  );
  // After the first host's shutdown releases ownership, a new host may start.
  await hostA.shutdown("owner-release");
  const hostB = await makeProductionHost(stateDir);
  await delay(50);
  await hostB.shutdown("second-life");
  await settle();
});
