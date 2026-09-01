"use strict";

/**
 * WAVE 5 LANE 4 — DSC-005 logical-history seam tests (ChannelManager).
 *
 * These tests exercise the canonical ChannelManager logical-conversation
 * keying (dsc:*).  The ChannelManager module requires the sqlite3 native
 * module; where it is unavailable (some CI/dev environments) the suite
 * skips gracefully rather than failing spuriously.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

let channelManagerModule = null;
try {
  channelManagerModule = require("../../src/channels/channelManager");
} catch {
  channelManagerModule = null; // sqlite3 native module unavailable here
}

test("DSC-005 seam: ChannelManager logical keys validate the dsc_* shape", { skip: channelManagerModule === null }, () => {
  const { ChannelManager } = channelManagerModule;
  const store = {
    load: async () => [],
    append: async (key, turn, meta) => ({ key, turn, meta }),
    clear: async () => {},
    list: async () => []
  };
  const cm = new ChannelManager(store);
  // Valid canonical continuity identity produces the logical key.
  assert.equal(cm.continuityKey("dsc_abc123"), "dsc:dsc_abc123");
  // Forged/invalid identities fail closed.
  for (const forged of ["ses_forged", "dsc_", "DSC_upper", "dsc_" + "x".repeat(200), "", null, 42]) {
    assert.throws(() => cm.continuityKey(forged), TypeError, JSON.stringify(String(forged)));
  }
});

test("DSC-005 seam: continuity remember routes through the existing store append", { skip: channelManagerModule === null }, async () => {
  const { ChannelManager } = channelManagerModule;
  const appended = [];
  const store = {
    load: async () => [],
    append: async (key, turn, meta) => { appended.push({ key, turn, meta }); return [turn]; },
    clear: async () => {},
    list: async () => []
  };
  const cm = new ChannelManager(store);
  await cm.continuityRemember("dsc_a1", { role: "user", content: "hi" }, { channel: "telegram" });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].key, "dsc:dsc_a1");
  assert.equal(appended[0].meta.channel, "telegram");
  assert.equal(appended[0].meta.kind, "logical");
});
