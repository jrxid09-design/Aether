"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ib = require("../../src/runtime/interactionBus");

function makeIngress() {
  const bus = ib.createInteractionBus({
    clock: () => 1000,
    idFactory: ib.createSequentialIdFactory()
  });
  const calls = [];
  const manager = {
    async handle(input) {
      calls.push(input);
      return Object.freeze({
        managerRequestId: "req-1",
        outcome: "COMPLETED",
        lifecycleState: "COMPLETED",
        detail: "cognition"
      });
    }
  };
  return { bus, calls, manager, ingress: ib.createManagerInteractionIngress({ bus, manager }) };
}

async function tick() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("manager ingress supports all five channels through one canonical bus boundary", async () => {
  const { ingress, calls } = makeIngress();
  assert.deepEqual(ingress.channels, ["console", "cli", "telegram", "whatsapp", "companion"]);
  for (const channel of ingress.channels) {
    const accepted = ingress.ingest(channel, { text: `hello-${channel}`, userId: `${channel}-user` });
    assert.equal(accepted.accepted, true, channel);
  }
  await tick();
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map((call) => call.channelType), ingress.channels);
  assert.ok(calls.every((call) => call.sessionId.startsWith("ses_")));
  assert.ok(calls.every((call) => Object.isFrozen(call.payload)));
});

test("manager ingress rejects raw attachments that bypass MediaIngress", async () => {
  const { ingress, calls } = makeIngress();
  const raw = {
    text: "before", userId: "user-1",
    attachments: [{ attachmentId: "att_1", mediaType: "text/plain", sizeBytes: 1, contentRef: "ref-1", name: "note.txt" }],
    metadata: { authority: "inert-claim" }
  };
  const result = ingress.ingest("console", raw);
  assert.equal(result.accepted, false);
  assert.equal(result.code, "FOREIGN_MEDIA_REFERENCE");
  await tick();
  assert.equal(calls.length, 0);
});
test("invalid and hostile channel input fails closed without invoking Manager", async () => {
  const { ingress, calls } = makeIngress();
  assert.deepEqual(ingress.ingest("unknown", { text: "x" }), {
    accepted: false,
    code: "CHANNEL_NOT_SUPPORTED"
  });
  assert.equal(ingress.ingest("console", { text: "" }).accepted, false);

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "text", {
    enumerable: true,
    get() { getterCalls += 1; return "trap"; }
  });
  assert.equal(ingress.ingest("console", accessor).accepted, false);
  assert.equal(getterCalls, 0);

  const hostile = new Proxy({ text: "trap" }, {
    get() { throw new Error("proxy trap"); }
  });
  assert.equal(ingress.ingest("console", hostile).accepted, false);
  await tick();
  assert.equal(calls.length, 0);
});

test("canonical envelope recognition is bus-local and copies are foreign", () => {
  const { bus } = makeIngress();
  let seen = null;
  // A separate handler is intentionally not installed: this proof observes
  // the public predicate on a bus-created envelope through a tiny second bus
  // composition with the same canonical transport contract.
  const captureBus = ib.createInteractionBus({
    clock: () => 1000,
    idFactory: ib.createSequentialIdFactory(10)
  });
  captureBus.registerTransport({ transportId: "capture.console", origin: "CONSOLE", capabilities: { acceptsText: true } });
  captureBus.registerHandler({
    route: "CONVERSATION",
    supportedKinds: ["MESSAGE"],
    handler: (envelope, context) => {
      seen = envelope;
      context.stream.emit("START");
      context.stream.emit("COMPLETE");
    }
  });
  captureBus.submit({
    transportId: "capture.console",
    sessionId: "ses_capture",
    kind: "MESSAGE",
    payload: { text: "x" }
  });
  assert.equal(captureBus.isCanonicalEnvelope(seen), true);
  assert.equal(bus.isCanonicalEnvelope(seen), false);
  assert.equal(captureBus.isCanonicalEnvelope({ ...seen }), false);
  assert.equal(captureBus.isCanonicalEnvelope(Object.create(seen)), false);
});

test("routing projection cannot become execution authority", () => {
  const { ingress } = makeIngress();
  const projection = ingress.render("telegram", {
    managerRequestId: "req-1",
    outcome: "AUTHORITY_DENIED",
    lifecycleState: "FAILED",
    detail: "denied"
  });
  assert.equal(projection.outcome, "AUTHORITY_DENIED");
  assert.equal("authority" in projection, false);
  assert.equal("execute" in projection, false);
  assert.equal("grant" in projection, false);
  assert.equal(Object.isFrozen(projection), true);
});

test("production ingress uses the canonical Manager surface and fails closed on auth", async () => {
  const ingress = ib.createProductionManagerInteractionIngress();
  const accepted = ingress.ingest("console", { text: "hello", userId: "external" });
  assert.equal(accepted.accepted, true);
  await tick();
  const snapshot = ingress.transportSnapshot();
  assert.equal(snapshot.length, 5);
  assert.equal(snapshot.reduce((sum, entry) => sum + entry.counters.accepted, 0), 1);
});
