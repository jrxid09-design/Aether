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

test("legacy Console plugin ingress fails before ToolRegistry execution", async () => {
    const controller = require("../../src/controllers/pluginController");
    const { ToolRegistry } = require("../../src/core/tools");
    const original = ToolRegistry.execute;
    let invoked = 0;
    ToolRegistry.execute = async () => { invoked++; return {}; };
    const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
    await controller.execute({ params: { id: "arbitrary.tool" }, body: { args: {} } }, response);
    ToolRegistry.execute = original;
    assert.equal(invoked, 0);
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, null);
    assert.match(response.body.message, /canonical Damar Manager/i);
});

test("legacy Console terminal mutators fail before TerminalRuntime", async () => {
    const controller = require("../../src/controllers/terminalController");
    const terminals = require("../../src/runtime/terminal/TerminalRuntime");
    const original = terminals.execute;
    let invoked = 0;
    terminals.execute = async () => { invoked++; return {}; };
    const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return body; } };
    await controller.execute({ params: { id: "t1" }, body: { command: "touch forbidden" } }, response);
    terminals.execute = original;
    assert.equal(invoked, 0);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /canonical Damar Manager/i);
});

test("production MCP tools/call is fail-closed before legacy registry execution", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/mcp/index.js"), "utf8");
    assert.match(source, /rejectLegacyActionRoute\("MCP tool"\)/);
    assert.doesNotMatch(source, /ToolRegistry\.execute\(/);
});

test("runtime restart and terminal WebSocket ingress are fail-closed", () => {
    const runtimeSource = fs.readFileSync(path.join(ROOT, "src/controllers/runtimeController.js"), "utf8");
    const wsSource = fs.readFileSync(path.join(ROOT, "src/ws/terminalGateway.js"), "utf8");
    assert.match(runtimeSource, /rejectLegacyActionRoute\("Console runtime"\)/);
    assert.match(wsSource, /LEGACY_ACTION_ROUTE_DISABLED/);
    assert.match(wsSource, /return reject\(socket, 503/);
});

test("external action ingress guard has no authority or executor surface", () => {
    const boundary = require("../../src/manager/legacyBoundary");
    assert.deepEqual(Object.keys(boundary).sort(), ["LEGACY_ACTION_ROUTE_DISABLED", "rejectLegacyActionMiddleware", "rejectLegacyActionRoute"]);
    assert.throws(() => boundary.rejectLegacyActionRoute("test"), error =>
        error.code === boundary.LEGACY_ACTION_ROUTE_DISABLED &&
        /canonical Damar Manager/.test(error.message));
});

test("high-risk Console families are wired to the fail-closed boundary", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/routes/api/v1/console.js"), "utf8");
    for (const route of [
        'router.post("/home/control", homeManagerOnly)',
        'router.post("/home/mqtt/publish", homeManagerOnly)',
        'router.post("/orchestrate", managerOnly)',
        'router.post("/lab/missions/:id/run", labManagerOnly)',
        'router.post("/lab/experiments/:id/run", labManagerOnly)',
        'router.post("/automation/run", automationManagerOnly)',
        'router.post("/mcp/restart", mcpManagerOnly)',
        'router.put("/devices", managerOnly)',
        'router.post("/memory", managerOnly)',
        'router.post("/voice/speak", managerOnly)',
        'router.post("/forge/:id/approve", managerOnly)'
    ]) assert.ok(source.includes(route), route);
});

test("legacy API agent chat cannot reach PlanExecutor plugin execution", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/routes/api/v1/index.js"), "utf8");
    assert.match(source, /rejectLegacyActionMiddleware\("legacy agent chat"\)/);
    assert.doesNotMatch(source, /chatController\.chat\s*\n\s*\)/);
});
