const test = require("node:test");
const assert = require("node:assert");

const providerConfig = require("../../src/services/providerConfigService");

/**
 * Provider GeminiWebApi (jembatan Gemini web→API, dukung gambar).
 *
 * Read-only: tidak mengubah provider aktif pengguna. Yang dijaga —
 * preset ada, keyless (tak butuh API key), muncul di Settings, dan
 * endpoint OpenAI-compatible candidate benar.
 */

test("preset GeminiWebApi ada, keyless, endpoint candidate benar", () => {
    const p = providerConfig.presets.geminiwebapi;
    assert.ok(p, "preset geminiwebapi harus ada");
    assert.equal(p.kind, "openai");
    assert.equal(p.keyless, true);
    assert.match(p.baseUrl, /:4981\/openai\/v1$/);
    assert.match(p.label, /GeminiWebApi/);
});

test("GeminiWebApi muncul di Settings tanpa mewajibkan key", () => {
    const d = providerConfig.describe();
    const g = d.providers.geminiwebapi;
    assert.ok(g, "GeminiWebApi harus terdaftar di describe() (Settings)");
    assert.equal(g.hasKey, false);
    assert.equal(g.defaultBaseUrl, "http://localhost:4981/openai/v1");
});

test("terpisah dari provider custom", () => {
    const d = providerConfig.describe();
    assert.ok(d.providers.custom, "custom tetap ada");
    assert.notEqual(d.providers.geminiwebapi.baseUrl, d.providers.custom.baseUrl || "");
});
