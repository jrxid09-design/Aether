const NDJSONParser = require("../../../core/http/NDJSONParser");

/**
 * Klien HTTP tipis untuk daemon Ollama.
 *
 * Semua endpoint mengacu pada REST API Ollama:
 *   GET  /api/version
 *   GET  /api/tags      -> model yang ter-install
 *   GET  /api/ps        -> model yang sedang dimuat di memori
 *   POST /api/show      -> detail satu model
 *   POST /api/chat      -> chat (stream = NDJSON)
 *   POST /api/pull      -> unduh model (stream = NDJSON)
 *   POST /api/embed     -> embedding
 */
class OllamaClient {

    constructor({
        httpClient,
        config
    } = {}) {

        if (!httpClient) {
            throw new Error("HttpClient is required.");
        }

        if (!config) {
            throw new Error("AIProviderConfig is required.");
        }

        this.httpClient = httpClient;

        this.config = config;

    }

    get baseUrl() {

        return (this.config.baseUrl ?? "http://localhost:11434")
            .replace(/\/+$/, "");

    }

    url(path) {

        return `${this.baseUrl}${path}`;

    }

    get headers() {

        return {
            ...(this.config.headers ?? {})
        };

    }

    /**
     * Cek daemon hidup atau tidak. Sengaja tidak melempar
     * error supaya bisa dipakai untuk polling status.
     */
    async health() {

        const started = Date.now();

        const response = await this.httpClient.get(
            this.url("/api/version"),
            {
                headers: this.headers,
                timeout: this.config.timeout ?? 5000
            }
        );

        return {
            online: response.success === true,
            latency: Date.now() - started,
            version: response.data?.version ?? null,
            error: response.success ? null : (response.error ?? response.statusText ?? "unreachable")
        };

    }

    async version() {

        return this.unwrap(
            await this.httpClient.get(
                this.url("/api/version"),
                { headers: this.headers, timeout: this.config.timeout }
            )
        );

    }

    /** Model yang ter-install di disk. */
    async tags() {

        const data = this.unwrap(
            await this.httpClient.get(
                this.url("/api/tags"),
                { headers: this.headers, timeout: this.config.timeout }
            )
        );

        return data?.models ?? [];

    }

    /** Model yang sedang dimuat di RAM/VRAM. */
    async ps() {

        const data = this.unwrap(
            await this.httpClient.get(
                this.url("/api/ps"),
                { headers: this.headers, timeout: this.config.timeout }
            )
        );

        return data?.models ?? [];

    }

    async show(model) {

        return this.unwrap(
            await this.httpClient.post(
                this.url("/api/show"),
                {
                    headers: this.headers,
                    body: { model },
                    timeout: this.config.timeout
                }
            )
        );

    }

    async chat(payload) {

        return this.unwrap(
            await this.httpClient.post(
                this.url("/api/chat"),
                {
                    headers: this.headers,
                    body: { ...payload, stream: false },
                    timeout: this.config.timeout
                }
            )
        );

    }

    async *stream(payload) {

        const stream = await this.httpClient.stream(
            this.url("/api/chat"),
            {
                headers: this.headers,
                body: { ...payload, stream: true },
                timeout: this.config.timeout
            }
        );

        yield* NDJSONParser.parse(stream);

    }

    /** Unduh model; menghasilkan progress chunk secara bertahap. */
    async *pull(model, { insecure = false } = {}) {

        const stream = await this.httpClient.stream(
            this.url("/api/pull"),
            {
                headers: this.headers,
                body: { model, insecure, stream: true },
                // Unduhan model bisa lama sekali.
                timeout: 1000 * 60 * 60
            }
        );

        yield* NDJSONParser.parse(stream);

    }

    async embed(model, input) {

        return this.unwrap(
            await this.httpClient.post(
                this.url("/api/embed"),
                {
                    headers: this.headers,
                    body: { model, input },
                    timeout: this.config.timeout
                }
            )
        );

    }

    /**
     * HttpClient mengembalikan envelope { success, status, data, error }
     * alih-alih melempar. Di sini envelope-nya dibuka jadi data mentah
     * atau Error yang informatif.
     */
    unwrap(response) {

        if (!response.success) {

            throw new Error(
                response.data?.error ??
                response.error ??
                response.statusText ??
                "Ollama request failed."
            );

        }

        return response.data;

    }

}

module.exports = OllamaClient;
