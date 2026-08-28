"use strict";

/**
 * ACTION INTENT + AUTHORITY GATE V1 — structural security audit.
 *
 * Proves structurally that the action module imports no shell/process
 * execution, filesystem mutation, network, device/browser actuation, or
 * Authority mutation APIs. It MAY import the canonical read-only evaluator
 * (src/authority/evaluate.js) and capability id grammar (read-only).
 *
 * Also proves the public surface exposes no execution verbs and no
 * authority-minting verbs, and that the canonical read-only evaluator is the
 * SINGLE source of truth (no duplicated policy in Lane 2).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("structural: action module imports no executors, authority mutators, fs/network/actuation", () => {
    const dir = path.join(__dirname, "../../src/action");
    const files = [];
    (function walk(d) {
        for (const f of fs.readdirSync(d)) {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) walk(p);
            else if (p.endsWith(".js")) files.push(p);
        }
    })(dir);

    const FORBIDDEN = [
        /child_process/,
        /node:child_process/,
        /node:net\b/,
        /node:http/,
        /node:https/,
        /node:dns/,
        /node:fetch/,
        /axios|undici|node-pty/,
        /\beval\s*\(/,
        /new\s+Function\s*\(/,
        /execSync|spawnSync|execFile|spawn\s*\(/,
        /node:fs\b/,
        /require\(\s*["']fs["']\s*\)/,
        /writeFile|readFile|appendFile|mkdir|rmdir|unlink|chmod|chown/,
        /consumeExecution/,
        /revokeSubjectGeneration/,
        /issueRatifiedRootGrant/,
        /bumpGeneration/,
        /appendEvent/
    ];
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        for (const rx of FORBIDDEN) {
            assert.ok(!rx.test(text), `${path.relative(process.cwd(), file)} matches forbidden pattern ${rx}`);
        }
    }

    // allowed external requires: intra-domain (./), node:crypto, capability ids
    // (read-only), and the canonical authority evaluator (read-only).
    for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
            const target = m[1];
            const ok =
                target.startsWith("./") ||
                target === "node:crypto" ||
                target === "../capability/registry/ids" ||
                target === "../authority/evaluate";
            assert.ok(ok, `${file}: unexpected external require '${target}'`);
        }
    }
});

test("structural: Lane 2 delegates to the single canonical evaluator (no policy duplication)", () => {
    // authorityContext.js must require the canonical evaluator, not re-implement
    // grant checks (no getGeneration/countConsumption/identityBinding logic).
    const text = fs.readFileSync(path.join(__dirname, "../../src/action/authorityContext.js"), "utf8");
    assert.ok(/evaluateAuthorityReadOnly/.test(text), "authorityContext must delegate to canonical evaluator");
    // gate.js must not itself contain grant-validation store reads (getGeneration/
    // countConsumption) or identity-binding logic (that lives in the canonical
    // evaluator). Reason-code string mapping is allowed.
    const gateText = fs.readFileSync(path.join(__dirname, "../../src/action/gate.js"), "utf8");
    assert.ok(!/getGeneration|countConsumption|identityBinding/.test(gateText),
        "gate must not duplicate authority grant policy");
});

test("surface: no execution verbs in public API", () => {
    const api = require("../../src/action");
    const gate = new api.ActionAuthorityGate({
        capabilityRegistry: { get: () => null },
        authorityContext: { evaluate: async () => ({ allowed: false }) }
    });
    const EXEC = /execute|invoke|run\b|dispatch|actuate|spawn|shell|callTool|performAction/i;
    for (const m of Object.getOwnPropertyNames(api.ActionAuthorityGate.prototype)) {
        assert.ok(!EXEC.test(m), `gate must not expose execution verb: ${m}`);
    }
    for (const v of ["execute", "invoke", "run", "dispatch", "actuate", "spawn", "shell", "callTool", "performAction"]) {
        assert.equal(typeof gate[v], "undefined", `no method '${v}'`);
    }
});

test("surface: no authority-minting verbs in public API", () => {
    const api = require("../../src/action");
    const gate = new api.ActionAuthorityGate({
        capabilityRegistry: { get: () => null },
        authorityContext: { evaluate: async () => ({ allowed: false }) }
    });
    const AUTH = /grant|authorize|approve|ratify|delegate|elevate|mint|issue\b|revoke/i;
    for (const m of Object.getOwnPropertyNames(api.ActionAuthorityGate.prototype)) {
        assert.ok(!AUTH.test(m), `gate must not expose authority-minting verb: ${m}`);
    }
    for (const v of ["grant", "authorize", "approve", "ratify", "delegate", "elevate", "mint", "issue", "revoke"]) {
        assert.equal(typeof gate[v], "undefined", `no method '${v}'`);
    }
});
