"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fsp = require("node:fs/promises");
const ib = require("../../src/runtime/interactionBus");
const { createRuntimeHost } = require("../../src/runtime/host/runtimeHost");
const { createMediaSubsystem, takePrivatePorts, CODES } = require("../../src/runtime/mediaIngress/subsystem");
const { createManagerInteractionIngress } = require("../../src/runtime/interactionBus/managerIngressInternal");
const { makeManagerHarness } = require("../manager/productionHarness");
const { createCanonicalMediaContext } = require("../../src/manager/internal/mediaContext");

const CHANNELS = ["console", "cli", "telegram", "whatsapp", "companion"];
const spec = (source, extra = {}) => ({ source, fileName: "item.bin", declaredMimeType: "application/octet-stream", sourceChannel: "console", ...extra });
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));

async function fixture(t, limits = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "damar-lane2-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const media = createMediaSubsystem({ storageRoot: root, limits, testMode: true });
  await media.ready;
  return { root, media };
}

function composeIngress(media, manager) {
  const privatePorts = takePrivatePorts(media);
  let bus;
  const mediaPorts = Object.freeze({
    bindAcceptedInteraction: (envelope) => privatePorts.bindAcceptedInteraction(bus, envelope),
    issueScopedAccess: privatePorts.issueScopedAccess,
    readScopedAccess: privatePorts.readScopedAccess,
    releaseScopedAccess: privatePorts.releaseScopedAccess,
    releaseTransient: privatePorts.releaseTransient
  });
  bus = ib.createInteractionBus({ clock: () => 1_000, idFactory: ib.createSequentialIdFactory(), mediaIngress: media, mediaPorts });
  return { bus, ingress: createManagerInteractionIngress({ bus, manager, mediaSubsystem: media }) };
}

const fakeManager = (onHandle = async () => ({ managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok" })) => Object.freeze({ handle: onHandle });

test("Lane 2 general media facade has no active processing authority", async (t) => {
  const { media } = await fixture(t);
  const names = [...Object.keys(media), ...Object.getOwnPropertyNames(media), ...Object.getOwnPropertySymbols(media).map(String), ...Object.getOwnPropertyNames(Object.getPrototypeOf(media))];
  for (const forbidden of ["bindAcceptedInteraction", "issueAccess", "issueScopedAccess", "readAccess", "readScopedAccess", "restore", "resume", "restart", "continuation", "privatePorts", "canonicalOwner"]) assert.equal(names.includes(forbidden), false, `${forbidden} leaked`);
  assert.equal(typeof media.ingest, "function");
  assert.equal(typeof media.isCanonicalMediaReference, "function");
});

test("canonical reference is inert and fabricated envelope cannot bind", async (t) => {
  const { root, media } = await fixture(t);
  const descriptor = await media.ingest(spec(Buffer.from("inert")));
  assert.equal(media.isCanonicalMediaReference(descriptor), true);
  assert.equal(media.isCanonicalMediaReference({ ...descriptor }), false);
  const { bus } = composeIngress(media, fakeManager());
  assert.throws(() => takePrivatePorts(media).bindAcceptedInteraction(bus, { interactionId: "ix_forged", accepted: true, trusted: true, payload: { attachments: [descriptor] } }), (error) => error.code === CODES.FOREIGN_REFERENCE);
  assert.deepEqual(await fsp.readdir(path.join(root, "relations")), []);
});

test("accepted active processing gets a scoped lazy reader and exact bytes", async (t) => {
  const { media } = await fixture(t); let reads = 0; let bytes = null;
  const { ingress } = composeIngress(media, fakeManager(async (_input, context) => {
    reads += 1; bytes = (await context.mediaContext.attachments[0].read()).bytes;
    return { managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok" };
  }));
  const result = await ingress.ingestAttachments("console", { text: "read", sessionId: "ses_lane2" }, [spec(Buffer.from("DAMAR-LANE2-MEDIA-CONTRACT"))]);
  assert.equal(result.accepted, true); await delay(); assert.equal(reads, 1); assert.deepEqual(bytes, Buffer.from("DAMAR-LANE2-MEDIA-CONTRACT"));
});

test("real Manager composition consumes branded lazy mediaContext after test-only authentication", async (t) => {
  const { media } = await fixture(t); const seen = [];
  const harness = await makeManagerHarness({ authenticate: (e) => e && e.sessionId === "ses_contract" ? { principal: "lane2-contract" } : null, mediaProcessor: async ({ mediaContext }) => seen.push((await mediaContext.attachments[0].read()).bytes) });
  const { ingress } = composeIngress(media, harness.manager);
  const accepted = await ingress.ingestAttachments("console", { text: "media", sessionId: "ses_contract" }, [spec(Buffer.from("DAMAR-LANE2-MEDIA-CONTRACT"))]);
  assert.equal(accepted.accepted, true); await delay(); assert.deepEqual(seen, [Buffer.from("DAMAR-LANE2-MEDIA-CONTRACT")]);
});

test("lazy hook does not read media unless it requests attachment.read", async (t) => {
  const { media } = await fixture(t); let hooks = 0;
  const harness = await makeManagerHarness({ authenticate: () => ({ principal: "lane2-contract" }), mediaProcessor: async () => { hooks += 1; } });
  const { ingress } = composeIngress(media, harness.manager);
  const accepted = await ingress.ingestAttachments("console", { text: "no-read", sessionId: "ses_contract" }, [spec(Buffer.from("not-read"))]);
  assert.equal(accepted.accepted, true); await delay(); assert.equal(hooks, 1);
});

test("foreign mediaContext shapes fail before traversal", async () => {
  const harness = await makeManagerHarness({ authenticate: () => ({ principal: "lane2-contract" }) });
  const base = { channelType: "console", channelId: "console", sessionId: "ses_context", payload: { text: "x" } };
  for (const context of [{}, new Proxy({}, {}), Object.create(createCanonicalMediaContext(Object.freeze([]))), { attachments: [{ attachmentId: "att_x", read: () => Buffer.from("x") }] }]) await assert.rejects(harness.manager.handle({ ...base, correlationId: `ctx-${Math.random()}` }, { mediaContext: context }), /MEDIA_CONTEXT_INVALID/);
});

test("terminal success revokes reader while durable relation remains", async (t) => {
  const { root, media } = await fixture(t); let reader;
  const { ingress } = composeIngress(media, fakeManager(async (_input, context) => { reader = context.mediaContext.attachments[0].read; await reader(); return { managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok" }; }));
  const accepted = await ingress.ingestAttachments("console", { text: "terminal", sessionId: "ses_terminal" }, [spec(Buffer.from("terminal"))]);
  assert.equal(accepted.accepted, true); await delay(); await assert.rejects(reader(), (error) => error.code === CODES.FOREIGN_REFERENCE); assert.equal((await fsp.readdir(path.join(root, "relations"))).length, 1);
});

for (const terminal of ["throw", "timeout", "cancel"]) test(`terminal ${terminal} revokes transient reader`, async (t) => {
  const { media } = await fixture(t); let reader;
  const manager = fakeManager(async (_input, context) => { reader = context.mediaContext.attachments[0].read; if (terminal === "throw") throw new Error("processor failed"); if (terminal === "timeout") await delay(); return { managerRequestId: "r", outcome: terminal === "cancel" ? "CANCELLED" : "COMPLETED", lifecycleState: terminal === "cancel" ? "CANCELLED" : "COMPLETED", detail: terminal }; });
  const { ingress } = composeIngress(media, manager);
  const result = await ingress.ingestAttachments("console", { text: terminal, sessionId: `ses_${terminal}` }, [spec(Buffer.from(terminal))]);
  assert.equal(result.accepted, true); await delay(); await assert.rejects(reader(), (error) => error.code === CODES.FOREIGN_REFERENCE);
});

test("restart reloads validated durable evidence without reader or Manager dispatch", async (t) => {
  const { root, media } = await fixture(t); let managerCalls = 0;
  const { ingress } = composeIngress(media, fakeManager(async () => { managerCalls += 1; return { managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok" }; }));
  const accepted = await ingress.ingestAttachments("console", { text: "restart", sessionId: "ses_restart" }, [spec(Buffer.from("persisted"))]);
  assert.equal(accepted.accepted, true); await delay(); const restarted = createMediaSubsystem({ storageRoot: root, testMode: true }); await restarted.ready;
  assert.equal((await fsp.readdir(path.join(root, "relations"))).length, 1); assert.equal(restarted.getDiagnostics().some((d) => d.result === "relation-quarantined"), false); assert.equal(typeof restarted.readAccess, "undefined"); assert.equal(managerCalls, 1);
});

test("restart isolates malformed relation and orphan catalog media remains inert", async (t) => {
  const { root, media } = await fixture(t); const descriptor = await media.ingest(spec(Buffer.from("orphan")));
  await fsp.writeFile(path.join(root, "relations", "ix_bad.json"), JSON.stringify({ schemaVersion: 1, interactionId: "ix_bad", attachments: [{ attachmentId: descriptor.attachmentId, mediaId: "med_ffffffffffffffffffffffffffffffff" }] }));
  const restarted = createMediaSubsystem({ storageRoot: root, testMode: true }); await restarted.ready;
  assert.equal(restarted.getDiagnostics().some((d) => d.result === "relation-quarantined"), true); assert.equal(restarted.isCanonicalMediaReference(descriptor), false); assert.equal(typeof restarted.readAccess, "undefined");
});

test("integrity rejects tampered object through legitimate active reader", async (t) => {
  const { root, media } = await fixture(t);
  const { ingress } = composeIngress(media, fakeManager(async (input, context) => { const d = input.payload.attachments[0]; await fsp.writeFile(path.join(root, "objects", `${d.sha256}.blob`), "tampered"); await assert.rejects(context.mediaContext.attachments[0].read(), (error) => error.code === CODES.INTEGRITY_FAILURE); return { managerRequestId: "r", outcome: "COMPLETED", lifecycleState: "COMPLETED", detail: "ok" }; }));
  const accepted = await ingress.ingestAttachments("console", { text: "integrity", sessionId: "ses_integrity" }, [spec(Buffer.from("original"))]); assert.equal(accepted.accepted, true); await delay();
});

test("maxRelations is durable capacity and catalog capacity stays atomic", async (t) => {
  const { root, media } = await fixture(t, { maxRelations: 1, maxBindings: 2 }); const { ingress } = composeIngress(media, fakeManager());
  const results = await Promise.all([ingress.ingestAttachments("console", { text: "a", sessionId: "ses_a" }, [spec(Buffer.from("a"))]), ingress.ingestAttachments("console", { text: "b", sessionId: "ses_b" }, [spec(Buffer.from("b"))])]);
  assert.equal(results.filter((x) => x.accepted).length, 1); assert.ok((await fsp.readdir(path.join(root, "relations"))).length <= 1);
  for (let run = 0; run < 100; run += 1) { const local = await fixture(t, { maxCatalogRecords: 1 }); const outcomes = await Promise.allSettled([local.media.ingest(spec(Buffer.from(`a-${run}`))), local.media.ingest(spec(Buffer.from(`b-${run}`)))]); assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1); }
});

test("runtime host preserves five channel ingestion while production Manager stays fail closed", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "damar-host-lane2-")); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const host = await createRuntimeHost({ coreOptions: { mediaStorageRoot: root } }); t.after(() => host.shutdown("test"));
  for (const channel of CHANNELS) assert.equal((await host.channels.ingestAttachments(channel, { text: channel, sessionId: `ses_${channel}` }, [spec(Buffer.from(channel), { sourceChannel: "forged" })])).accepted, true);
  await delay(); assert.equal((await fsp.readdir(path.join(root, "relations"))).length, 5);
  const { createDamarManager } = require("../../src/manager/bootstrap"); const manager = createDamarManager();
  for (const payload of [{ authenticated: true }, { trusted: true }, { role: "admin" }, { testMode: true }, { session: { principal: "admin" } }]) assert.equal((await manager.handle({ channelType: "console", channelId: "console", sessionId: "ses_auth", correlationId: `auth-${Math.random()}`, payload: { text: "x", ...payload } })).outcome, "AUTHENTICATION_REQUIRED");
});
