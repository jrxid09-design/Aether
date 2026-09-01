"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("canonical local-only TTS never contacts configured remote or edge fallback", async () => {
    const oldUrl = process.env.DAMAR_TTS_URL;
    const oldVoice = process.env.DAMAR_TTS_VOICE;
    const oldFetch = global.fetch;
    process.env.DAMAR_TTS_URL = "https://paid.example/v1/audio/speech";
    process.env.DAMAR_TTS_VOICE = "af_heart";
    let fetches = 0;
    global.fetch = async () => { fetches += 1; throw new Error("network called"); };
    const voice = require("../../src/services/voiceService");
    try {
        await assert.rejects(voice.speak("hello", { localOnly: true }), (error) => error.code === "TTS_ALL_FAILED");
        assert.equal(fetches, 0);
    } finally {
        if (oldUrl === undefined) delete process.env.DAMAR_TTS_URL; else process.env.DAMAR_TTS_URL = oldUrl;
        if (oldVoice === undefined) delete process.env.DAMAR_TTS_VOICE; else process.env.DAMAR_TTS_VOICE = oldVoice;
        global.fetch = oldFetch;
    }
});

test("canonical local-only STT rejects remote endpoint before network", async () => {
    const oldUrl = process.env.DAMAR_STT_URL;
    const oldFetch = global.fetch;
    process.env.DAMAR_STT_URL = "https://paid.example/v1/audio/transcriptions";
    let fetches = 0;
    global.fetch = async () => { fetches += 1; throw new Error("network called"); };
    const voice = require("../../src/services/voiceService");
    try {
        await assert.rejects(voice.transcribe(Buffer.from("audio"), { localOnly: true }), (error) => error.code === "STT_LOCAL_REQUIRED");
        assert.equal(fetches, 0);
    } finally {
        if (oldUrl === undefined) delete process.env.DAMAR_STT_URL; else process.env.DAMAR_STT_URL = oldUrl;
        global.fetch = oldFetch;
    }
});
