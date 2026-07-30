/**
 * Klien HTTP untuk bidang kendali daemon Aether.
 *
 * Sengaja cerminan dari apps/console/renderer/lib/api.js — CLI
 * dan Console memakai kontrak yang sama, jadi keduanya bergerak
 * bersama saat API berubah.
 */
class DaemonClient {

    constructor({ baseUrl, token } = {}) {

        this.baseUrl = String(
            baseUrl ?? process.env.AETHER_URL ?? "http://localhost:3000"
        ).replace(/\/+$/, "");

        this.token = token ?? process.env.AETHER_TOKEN ?? "";

    }

    get root() {
        return `${this.baseUrl}/api/v1/console`;
    }

    headers(extra = {}) {

        const headers = { ...extra };

        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }

        return headers;

    }

    async request(path, { method = "GET", body = null, timeout = 20000 } = {}) {

        const controller = new AbortController();

        const timer = setTimeout(() => controller.abort(), timeout);

        try {

            const response = await fetch(`${this.root}${path}`, {
                method,
                headers: this.headers(
                    body ? { "Content-Type": "application/json" } : {}
                ),
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            const payload = await response.json().catch(() => null);

            if (!response.ok || payload?.success === false) {
                throw new Error(
                    payload?.message ?? `HTTP ${response.status} ${response.statusText}`
                );
            }

            return payload?.data ?? payload;

        }

        catch (error) {

            if (error.name === "AbortError") {
                throw new Error("Permintaan melebihi batas waktu.");
            }

            if (error instanceof TypeError) {
                throw new Error(`Tidak bisa menghubungi daemon di ${this.baseUrl}`);
            }

            throw error;

        }

        finally {
            clearTimeout(timer);
        }

    }

    // ---- Endpoint yang dipakai CLI ------------------------------

    overview()          { return this.request("/overview", { timeout: 25000 }); }
    stats()             { return this.request("/stats"); }
    providers()         { return this.request("/ai/providers", { timeout: 25000 }); }
    selectProvider(id)  { return this.request("/ai/provider", { method: "POST", body: { id } }); }
    models(provider)    { return this.request(`/ai/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`, { timeout: 25000 }); }
    selectModel(model)  { return this.request("/ai/model", { method: "POST", body: { model } }); }
    tools()             { return this.request("/tools"); }
    runTool(id, args)   { return this.request(`/tools/${encodeURIComponent(id)}/execute`, { method: "POST", body: { args }, timeout: 60000 }); }
    recall(body)        { return this.request("/memory/recall", { method: "POST", body, timeout: 30000 }); }
    remember(body)      { return this.request("/memory", { method: "POST", body }); }
    forget(id)          { return this.request(`/memory/${id}`, { method: "DELETE" }); }
    memoryStats()       { return this.request("/memory/stats", { timeout: 25000 }); }
    integrations()      { return this.request("/integrations"); }

    /**
     * Chat streaming. Memanggil onChunk untuk tiap potongan SSE.
     * Body fetch di Node adalah ReadableStream web; SSE diurai
     * manual seperti di Console.
     */
    async streamChat(payload, onChunk, signal = null) {

        const response = await fetch(`${this.root}/ai/stream`, {
            method: "POST",
            headers: this.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify(payload),
            signal
        });

        if (!response.ok) {
            const detail = await response.json().catch(() => null);
            throw new Error(detail?.message ?? `HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        while (true) {

            const { value, done } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            const frames = buffer.split(/\r?\n\r?\n/);

            buffer = frames.pop() ?? "";

            for (const frame of frames) {

                let event = "message";
                const dataLines = [];

                for (const line of frame.split(/\r?\n/)) {
                    if (line.startsWith("event:")) {
                        event = line.slice(6).trim();
                    }
                    else if (line.startsWith("data:")) {
                        dataLines.push(line.slice(5).trim());
                    }
                }

                if (dataLines.length === 0) {
                    continue;
                }

                try {
                    onChunk({ event, data: JSON.parse(dataLines.join("\n")) });
                }
                catch {
                    // Frame tak utuh — abaikan, jangan putus stream.
                }

            }

        }

    }

    /** Probe cepat: daemon hidup atau tidak. */
    async ping() {

        try {
            await this.request("/stats", { timeout: 2500 });
            return true;
        }
        catch {
            return false;
        }

    }

}

module.exports = DaemonClient;
