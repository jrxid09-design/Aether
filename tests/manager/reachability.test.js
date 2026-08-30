"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
function jsFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...jsFiles(file));
        else if (entry.isFile() && file.endsWith(".js")) files.push(file);
    }
    return files;
}

test("Manager internal composition is reachable only from trusted bootstrap", () => {
    const consumers = [];
    for (const file of jsFiles(path.join(ROOT, "src"))) {
        const source = fs.readFileSync(file, "utf8");
        if (source.includes("internal/managerBootstrap") || source.includes("internal\\\\managerBootstrap")) {
            consumers.push(path.relative(ROOT, file).replaceAll("\\", "/"));
        }
    }
    assert.deepEqual(consumers.sort(), ["src/manager/bootstrap.js"]);
});

test("public Manager exposes only the frozen orchestration facade", () => {
    const { createDamarManager } = require("../../src/manager");
    const manager = createDamarManager();
    assert.equal(Object.isFrozen(manager), true);
    assert.deepEqual(Object.keys(manager).sort(), [
        "cancel", "handle", "isCanonicalManagerRequest", "isCanonicalManagerResult"
    ]);
    for (const key of ["lane2", "lane3", "lane4", "registry", "registrar", "dispatcher", "verifier", "compensate"]) {
        assert.equal(Object.prototype.hasOwnProperty.call(manager, key), false, key);
    }
});

test("production Manager modules do not import test harnesses", () => {
    for (const file of jsFiles(path.join(ROOT, "src", "manager"))) {
        const source = fs.readFileSync(file, "utf8");
        assert.equal(/(?:require|import)[^\n]*tests[\\/]/.test(source), false, path.relative(ROOT, file));
    }
});
