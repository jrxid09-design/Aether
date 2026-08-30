"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const RuntimeExecutor = require("../../src/ai/executors/RuntimeExecutor");
const Authorization = require("../../src/ai/tools/Authorization");

const toolCall = name => ({ id: "malicious-1", name, arguments: {} });

function registry(counter) {
    return {
        get(name) {
            if (name !== "system__time__currentTime") return null;
            return {
                name,
                parameters: {},
                execute: async () => { counter.count++; return { now: 1 }; }
            };
        }
    };
}

test("RuntimeExecutor ignores unsolicited non-stream tool calls without trusted execution", async () => {
    for (const request of [
        { tools: [] },
        { tools: [toolCall("system__time__currentTime")] },
        { tools: [], exec: { toolExecutionAuthorized: true } }
    ]) {
        const counter = { count: 0 };
        const executor = new RuntimeExecutor({
            chat: async () => ({ content: "advisory", toolCalls: [toolCall("system__time__currentTime")] })
        }, { callTimeout: 1000 });
        executor.setToolRegistry(registry(counter));
        const result = await executor.execute({
            messages: [{ role: "user", content: "run it" }],
            role: "system",
            channel: "internal",
            ...request
        });
        assert.equal(counter.count, 0);
        assert.deepEqual(result.toolCalls, []);
    }
});

test("RuntimeExecutor streaming ignores unsolicited tool calls without trusted execution", async () => {
    const counter = { count: 0 };
    const executor = new RuntimeExecutor({
        stream: async function* () {
            yield { toolCalls: [toolCall("system__time__currentTime")], finishReason: "tool_calls", done: true };
        }
    }, { callTimeout: 1000 });
    executor.setToolRegistry(registry(counter));
    const chunks = [];
    for await (const chunk of executor.stream({
        messages: [{ role: "user", content: "run it" }],
        tools: [],
        role: "system",
        channel: "internal"
    })) chunks.push(chunk);
    assert.equal(counter.count, 0);
    assert.equal(chunks.some(chunk => chunk.toolCalls?.length), false);
    assert.equal(chunks.at(-1).done, true);
});

test("RuntimeExecutor permits a tool only with canonical internal grant provenance", async () => {
    const counter = { count: 0 };
    const executor = new RuntimeExecutor({
        chat: async request => request.messages.some(message => message.role === "tool")
            ? { content: "done", toolCalls: [] }
            : { content: "", toolCalls: [toolCall("system__time__currentTime")] }
    }, { callTimeout: 1000 });
    executor.setToolRegistry(registry(counter));
    const grant = Object.assign(
        Authorization.resolveDelegator(null, true, "runtime-test"),
        { role: "system" }
    );
    const result = await executor.execute({
        messages: [{ role: "user", content: "run it" }],
        tools: [toolCall("system__time__currentTime")],
        exec: grant
    });
    assert.equal(counter.count, 1);
    assert.deepEqual(result.toolCalls, []);
});
