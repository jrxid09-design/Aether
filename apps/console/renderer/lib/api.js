/**
 * Klien untuk bidang kendali daemon Aether.
 *
 * Semua permintaan lewat satu titik agar base URL, token, dan
 * penanganan error tidak tersebar di seluruh view.
 */
class AetherApi {

    constructor() {

        this.baseUrl = "http://localhost:3000";

        this.token = "";

        /** Pembatalan untuk stream chat yang sedang berjalan. */
        this.chatAbort = null;

        this.eventSource = null;

    }

    configure({ baseUrl, token }) {

        if (baseUrl) {
            this.baseUrl = String(baseUrl).replace(/\/+$/, "");
        }

        this.token = token ?? "";

        return this;

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
                    payload?.message ??
                    `HTTP ${response.status} ${response.statusText}`
                );

            }

            return payload?.data ?? payload;

        }

        catch (error) {

            if (error.name === "AbortError") {
                throw new Error("Permintaan melebihi batas waktu.");
            }

            // fetch melempar TypeError yang sama untuk daemon mati,
            // port salah, maupun host tak terjangkau — jadikan pesan
            // yang bisa ditindaklanjuti.
            if (error instanceof TypeError) {
                throw new Error(`Tidak bisa menghubungi daemon di ${this.baseUrl}`);
            }

            throw error;

        }

        finally {
            clearTimeout(timer);
        }

    }

    // ---- Ringkasan & telemetri ----------------------------------

    overview()          { return this.request("/overview", { timeout: 25000 }); }
    stats()             { return this.request("/stats"); }
    logs(limit = 200)   { return this.request(`/logs?limit=${limit}`); }

    // ---- AI -----------------------------------------------------

    providers()         { return this.request("/ai/providers", { timeout: 25000 }); }
    selectProvider(id)  { return this.request("/ai/provider", { method: "POST", body: { id } }); }
    models(provider)    { return this.request(`/ai/models${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`, { timeout: 25000 }); }
    selectModel(model)  { return this.request("/ai/model", { method: "POST", body: { model } }); }
    metrics()           { return this.request("/ai/metrics"); }

    // ---- Plugin & tool -------------------------------------------

    plugins()           { return this.request("/plugins"); }
    tools()             { return this.request("/tools"); }

    runTool(id, args)   {
        return this.request(
            `/tools/${encodeURIComponent(id)}/execute`,
            { method: "POST", body: { args }, timeout: 60000 }
        );
    }

    // ---- Integrasi ------------------------------------------------

    integrations()      { return this.request("/integrations"); }
    checkIntegrations() { return this.request("/integrations/check", { method: "POST", timeout: 30000 }); }
    checkIntegration(id){ return this.request(`/integrations/${encodeURIComponent(id)}/check`, { method: "POST", timeout: 20000 }); }

    updateIntegration(id, patch) {
        return this.request(
            `/integrations/${encodeURIComponent(id)}`,
            { method: "PATCH", body: patch, timeout: 20000 }
        );
    }

    // ---- Memori ------------------------------------------------------

    memoryStats()       { return this.request("/memory/stats", { timeout: 25000 }); }

    memories(params = {}) {

        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value != null && value !== "")
        );

        return this.request(`/memory?${query}`);

    }

    memory(id)          { return this.request(`/memory/${id}`); }

    recall(body)        { return this.request("/memory/recall", { method: "POST", body, timeout: 30000 }); }

    remember(body)      { return this.request("/memory", { method: "POST", body }); }

    updateMemory(id, body) { return this.request(`/memory/${id}`, { method: "PATCH", body }); }

    forget(id)          { return this.request(`/memory/${id}`, { method: "DELETE" }); }

    consolidate(dryRun) {
        return this.request(
            `/memory/consolidate${dryRun ? "?dryRun=true" : ""}`,
            { method: "POST", timeout: 60000 }
        );
    }

    entities(params = {}) {

        const query = new URLSearchParams(
            Object.entries(params).filter(([, value]) => value != null && value !== "")
        );

        return this.request(`/memory/entities?${query}`);

    }

    entity(id)          { return this.request(`/memory/entities/${id}`); }

    createEntity(body)  { return this.request("/memory/entities", { method: "POST", body }); }

    removeEntity(id)    { return this.request(`/memory/entities/${id}`, { method: "DELETE" }); }

    documents(query)    {
        return this.request(`/memory/documents${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    }

    documentChunks(id)  { return this.request(`/memory/documents/${id}/chunks`); }

    // Ingest folder bisa memakan waktu lama, jadi diberi tenggat sendiri.
    ingest(body)        { return this.request("/memory/documents", { method: "POST", body, timeout: 300000 }); }

    removeDocument(id)  { return this.request(`/memory/documents/${id}`, { method: "DELETE" }); }

    embeddingStatus()   { return this.request("/memory/embeddings"); }

    backfillEmbeddings() {
        return this.request("/memory/embeddings/backfill", { method: "POST", timeout: 300000 });
    }

    // ---- Perangkat -------------------------------------------------

    devices()             { return this.request("/devices"); }
    saveDevices(patch)    { return this.request("/devices", { method: "PUT", body: patch }); }
    addSensor(sensor)     { return this.request("/devices/sensors", { method: "POST", body: sensor }); }
    removeSensor(id)      { return this.request(`/devices/sensors/${encodeURIComponent(id)}`, { method: "DELETE" }); }
    sensorReadings()      { return this.request("/devices/sensors/readings", { timeout: 20000 }); }

    // ---- Chat streaming --------------------------------------------

    /**
     * Streaming memakai fetch, bukan EventSource, karena butuh POST
     * dengan body. Potongan SSE diurai manual dari ReadableStream.
     *
     * @param {object} payload
     * @param {(chunk: object) => void} onChunk
     * @returns {Promise<{ aborted: boolean }>}
     */
    async streamChat(payload, onChunk) {

        this.chatAbort = new AbortController();

        let response;

        try {

            response = await fetch(`${this.root}/ai/stream`, {
                method: "POST",
                headers: this.headers({ "Content-Type": "application/json" }),
                body: JSON.stringify(payload),
                signal: this.chatAbort.signal
            });

        }
        catch (error) {

            if (error.name === "AbortError") {
                return { aborted: true };
            }

            throw new Error(`Tidak bisa menghubungi daemon di ${this.baseUrl}`);

        }

        if (!response.ok) {

            const detail = await response.json().catch(() => null);

            throw new Error(
                detail?.message ?? `HTTP ${response.status} ${response.statusText}`
            );

        }

        const reader = response.body.getReader();

        const decoder = new TextDecoder();

        let buffer = "";

        try {

            while (true) {

                const { value, done } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                const frames = buffer.split(/\r?\n\r?\n/);

                buffer = frames.pop() ?? "";

                for (const frame of frames) {
                    this.dispatchFrame(frame, onChunk);
                }

            }

        }

        catch (error) {

            if (error.name === "AbortError") {
                return { aborted: true };
            }

            throw error;

        }

        finally {
            this.chatAbort = null;
        }

        return { aborted: false };

    }

    dispatchFrame(frame, onChunk) {

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
            return;
        }

        try {
            onChunk({ event, data: JSON.parse(dataLines.join("\n")) });
        }
        catch {
            // Frame tak utuh: abaikan alih-alih memutus stream.
        }

    }

    stopChat() {

        this.chatAbort?.abort();

        this.chatAbort = null;

    }

    // ---- Aliran telemetri -------------------------------------------

    /**
     * EventSource tidak bisa mengirim header, jadi token dilewatkan
     * sebagai query — middleware auth menerima keduanya.
     */
    connectEvents({ onLog, onEvent, onOpen, onError }) {

        this.disconnectEvents();

        const url = new URL(`${this.root}/events`);

        if (this.token) {
            url.searchParams.set("token", this.token);
        }

        const source = new EventSource(url.toString());

        source.addEventListener("hello", e => {
            onOpen?.(JSON.parse(e.data));
        });

        source.addEventListener("log", e => {
            onLog?.(JSON.parse(e.data));
        });

        source.addEventListener("event", e => {
            onEvent?.(JSON.parse(e.data));
        });

        source.onerror = () => onError?.();

        this.eventSource = source;

        return source;

    }

    disconnectEvents() {

        this.eventSource?.close();

        this.eventSource = null;

    }

}

export const api = new AetherApi();
