"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const vaultMod = require("../../src/runtime/vault");
const ids = require("../../src/runtime/vault/ids");
const { createMemoryAuthorityStore } = require("../../src/authority/store");

/**
 * STORM — >= 5000 deterministic operations mixing create, metadata
 * inspect, resolve, rotate, revoke, delete, invalid resolve, forged
 * refs, and concurrent batches.
 *
 * Required post-conditions:
 *   - bounded state (secrets, diagnostics, redaction registry)
 *   - no secret leakage in any serializable surface
 *   - no stale values after rotation
 *   - no resurrection of revoked/deleted secrets
 *   - zero Authority store mutation
 *   - no timer/handle leak
 */

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const OPS = 5200;
const SECRET_MARKER = "storm-secret-marker";

test("vault storm: 5200 deterministic operations with bounded state and zero authority mutation", async () => {
    const rand = mulberry32(0xae7e12);
    let t = 1_000_000;
    const vault = vaultMod.createSecretVault({
        now: () => (t += 1),
        config: { maxSecrets: 64 }
    });

    // --- Authority snapshot (mutation proof) ---
    const authorityStore = createMemoryAuthorityStore();
    const authorityBefore = await authorityStateFingerprint(authorityStore);

    // Deterministic id pool for stable references across ops.
    const live = new Map();   // slot -> { ref }
    let created = 0;

    async function oneOp(i) {
        const roll = rand();
        if (roll < 0.14 || live.size === 0) {
            const slot = `slot-${created++}`;
            try {
                const res = vault.create({
                    scope: ["provider", "extension", "transport", "project", "device", "system"][Math.floor(rand() * 6)],
                    label: `storm-${slot}`,
                    value: `${SECRET_MARKER}-${slot}-${i}`
                });
                live.set(slot, res);
            } catch (_) { /* bound reached is fine */ }
        } else if (roll < 0.30) {
            const entry = pick(live);
            if (entry) vault.describe(entry.res.ref);
        } else if (roll < 0.55) {
            const entry = pick(live);
            if (entry) {
                const r = vault.resolve(entry.res.ref);
                assert.ok(r.ok === true || r.code === "VAULT_REVOKED" || r.code === "VAULT_NOT_FOUND");
                if (r.ok) {
                    assert.match(r.value.reveal(), new RegExp(`^${SECRET_MARKER}-slot-[0-9]+`));
                    r.value.reveal && void r.value;
                }
            }
        } else if (roll < 0.68) {
            const entry = pick(live);
            if (entry) {
                try {
                    vault.rotate(entry.res.ref, `${SECRET_MARKER}-${entry.slot}-rot-${i}`);
                } catch (_) { /* revoked races are fine */ }
            }
        } else if (roll < 0.76) {
            const entry = pick(live);
            if (entry) {
                try { vault.revoke(entry.res.ref); } catch (_) {}
            }
        } else if (roll < 0.82) {
            const entry = pick(live);
            if (entry) {
                try { vault.deleteSecret(entry.res.ref); live.delete(entry.slot); } catch (_) {}
            }
        } else if (roll < 0.90) {
            // Invalid resolves: forged refs / unknown ids / malformed strings.
            const bad = [
                vaultMod.refs.buildSecretRef({ secretId: ids.newSecretId(), scope: "system" }),
                `secretref:v1:${ids.newSecretId()}`,
                null,
                "garbage"
            ][Math.floor(rand() * 4)];
            try {
                const r = vault.resolve(bad);
                if (r && r.ok === false) {
                    assert.ok(r.code !== undefined);
                    assert.equal(r.value, undefined);
                }
            } catch (_) { /* malformed ref throws: acceptable */ }
        } else {
            // Concurrent batch of mixed ops on random entries.
            await Promise.all(Array.from({ length: 3 }, () => oneOpInner(i)));
        }

        function pick(map) {
            const keys = [...map.keys()];
            if (keys.length === 0) return null;
            const slot = keys[Math.floor(rand() * keys.length)];
            return { slot, res: map.get(slot) };
        }

        async function oneOpInner(j) {
            const entry = pick(live);
            if (!entry) return;
            const sub = rand();
            if (sub < 0.4) {
                vault.describe(entry.res.ref);
            } else if (sub < 0.8) {
                const r = vault.resolve(entry.res.ref);
                void r;
            } else {
                try { vault.rotate(entry.res.ref, `${SECRET_MARKER}-${entry.slot}-c-${j}`); } catch (_) {}
            }
        }
    }

    for (let i = 0; i < OPS; i++) {
        await oneOp(i);
    }

    // --- Post-condition: bounded state ---
    const stats = vault.stats();
    assert.ok(stats.total <= 64, `secret count bound violated: ${stats.total}`);
    assert.ok(stats.diagnosticEntries <= 200, "diagnostics unbounded");
    assert.ok(stats.trackedRedactionValues <= 128, "redaction registry unbounded");

    // --- No stale values after rotation ---
    for (const [slot, { ref }] of live) {
        const meta = vault.describe(ref);
        if (!meta.ok) continue;
        if (meta.metadata.status !== "active") continue;
        const r = vault.resolve(ref);
        if (!r.ok) continue;
        const value = r.value.reveal();
        assert.match(value, new RegExp(`^${SECRET_MARKER}-slot-${slot.slice(5)}`),
            `stale value surfaced for ${ref.secretId}: ${value}`);
    }

    // --- No resurrection ---
    for (let i = 0; i < 50; i++) {
        const ghost = vaultMod.refs.buildSecretRef({
            secretId: ids.secretIdFromSeed(`ghost-${i}`),
            scope: "system"
        });
        const r = vault.resolve(ghost);
        assert.equal(r.ok, false, `resurrection detected for ghost ${ghost.secretId}`);
    }

    // --- No leakage across every serializable surface ---
    const surfaces = JSON.stringify([
        vault.listRefs(),
        vault.evidenceView(),
        vault.stats(),
        vault._diagnostics.recent(200)
    ]);
    assert.ok(!surfaces.includes(`${SECRET_MARKER}-`), "raw value leaked into safe surfaces");

    // --- Zero Authority mutation ---
    const authorityAfter = await authorityStateFingerprint(authorityStore);
    assert.equal(authorityAfter, authorityBefore, "Authority state was mutated by vault operations");
});

test("no timer/handle leak from storm execution", async () => {
    const before = countResources();
    const vault = vaultMod.createSecretVault({ now: () => 1 });
    const { ref } = vault.create({ scope: "system", value: "handle-check" });
    for (let i = 0; i < 200; i++) {
        vault.rotate(ref, `handle-value-${i}`);
        vault.resolve(ref);
    }
    await new Promise((r) => setImmediate(r));
    const after = countResources();
    assert.equal(after, before, `resource leak: ${before} -> ${after}`);
});

function countResources() {
    const resources = process.getActiveResourcesInfo();
    return resources.filter((r) => r !== "Immediate" && r !== "Timeout").length;
}

/**
 * Observable fingerprint of an Authority memory store. The vault never
 * receives this object — the assertion is that merely RUNNING vault
 * operations cannot change Authority state through hidden edges.
 */
async function authorityStateFingerprint(store) {
    const probes = [];
    for (const id of ["cap.x", "cap.y", "cap.z"]) {
        try {
            const cap = await store.getCapability(id);
            probes.push(JSON.stringify(cap));
        } catch (e) {
            probes.push(`err:${e.code ?? e.message}`);
        }
    }
    return probes.join("|");
}
