const test = require("node:test");
const assert = require("node:assert");

/**
 * ACC CONTINUITY (§8–§9/§46–§53) — identitas, jurnal, replay,
 * restart, dedupe event, integritas rantai hash.
 */

const acc = require("../../src/cognition");
const { createMemoryAccStore } = require("../../src/cognition/persistence/AccStore");

function makeCore(store, clock, overrides = {}) {
    return new acc.ContinuityCore({
        store: store ?? createMemoryAccStore(),
        clock: clock ?? acc.manualClock(1_000_000),
        config: acc.createACCConfig({ AETHER_ACC: "shadow" }, overrides)
    });
}

const env = (type, payload, extra = {}) => acc.envelope.makeEnvelope({
    type, source: extra.source ?? "test", provenance: extra.provenance ?? "SYSTEM_EVENT",
    payload, clock: { nowMs: () => 1_000_000 }
});

test("C0.1: identitas dibuat SEKALI; core kedua pada store yang sama mewarisi", async () => {

    const store = createMemoryAccStore();
    const c1 = await makeCore(store).initialize();

    assert.ok(c1.state.identity.identityId, "identitas terinisialisasi");

    const idBefore = c1.state.identity.identityId;
    const contBefore = c1.state.identity.continuityId;

    // "Restart": instance baru di atas store yang sama.
    const c2 = await makeCore(store).initialize();

    assert.equal(c2.state.identity.identityId, idBefore,
        "identityId TIDAK boleh berubah karena restart");
    assert.equal(c2.state.identity.continuityId, contBefore,
        "continuityId TIDAK boleh berubah karena restart");
    assert.notEqual(c2.bootId, c1.bootId, "bootId WAJIB baru tiap boot");

    // Boot epoch tercatat dua kali, identitas tetap satu.
    assert.equal(
        c2.state.boots.length >= 2, true);
});

test("C0.1: replay deterministik — digest live == digest restore", async () => {

    const store = createMemoryAccStore();
    const c1 = await makeCore(store).initialize();

    await c1.feed(env("COMMITMENT_ADDED",
        { commitmentId: "c-1", statement: "jaga kontinuitas",
          source: "USER_EXPLICIT", priority: 0.8 }));
    await c1.feed(env("TOOL_FAILED",
        { tool: "browse" }, { provenance: "OBSERVATION" }));
    await c1.observeSubstrateChange({ provider: "ox", modelId: "ox-alpha" });

    // Snapshot + tambahan event setelahnya → jalur snapshot+replay.
    await c1.snapshot();
    await c1.feed(env("TOOL_SUCCEEDED",
        { tool: "memory_recall" }, { provenance: "OBSERVATION" }));

    const digestLive = c1.semanticDigest();

    // Instance baru: muat snapshot lalu replay sisanya.
    const c2 = await makeCore(store).initialize();
    const digestRestored = c2.semanticDigest();

    assert.equal(digestRestored, digestLive,
        "snapshot+replay wajib merekonstruksi state yang sama persis");
});

test("C0.1: duplikasi eventId diterapkan SEKALI (§102)", async () => {

    const c = await makeCore().initialize();

    const e = env("COMMITMENT_ADDED",
        { commitmentId: "dup", statement: "sekali saja",
          source: "USER_EXPLICIT" });

    const first = await c.feed(e);
    const second = await c.feed(e);

    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(Object.keys(c.state.commitments.active).length, 1);
});

test("C0.1: reset kontinuitas eksplisit → epoch baru, identityId tetap, lineage dicatat", async () => {

    const c = await makeCore().initialize();

    const identityId = c.state.identity.identityId;
    const oldContinuity = c.state.identity.continuityId;

    await c.createContinuityEpoch("reset destruktif oleh operator");

    assert.equal(c.state.identity.identityId, identityId);
    assert.notEqual(c.state.identity.continuityId, oldContinuity);
    assert.equal(c.state.identity.lineage.length, 1);
    assert.equal(c.state.identity.lineage[0].continuityId, oldContinuity);
});

test("C0.1: integritas rantai hash jurnal terverifikasi", async () => {

    const c = await makeCore().initialize();
    await c.feed(env("TOOL_SUCCEEDED",
        { tool: "x" }, { provenance: "OBSERVATION" }));
    await c.feed(env("TOOL_FAILED",
        { tool: "x" }, { provenance: "OBSERVATION" }));

    const verdict = await c.verifyJournalIntegrity();
    assert.equal(verdict.ok, true);
    assert.ok(verdict.length >= 3, "jurnal berisi event init+boot+feed");
});
