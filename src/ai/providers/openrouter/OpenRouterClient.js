const SSEParser = require("../../../core/http/SSEParser");

class OpenRouterClient {

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

    async chat(payload) {

        const url = `${this.config.baseUrl}/chat/completions`;

        const response = await this.httpClient.post(

            url,

            {

                headers: {

                    Authorization: `Bearer ${this.config.apiKey}`

                },

                body: payload

            }

        );

        if (!response.success) {

            // Sertakan status HTTP pada error agar runtime bisa
            // bereaksi (mis. 404 model usang → fallback otomatis).
            const error = new Error(
                response.data?.error?.message ??
                response.error ??
                response.statusText ??
                "OpenRouter request failed."
            );
            error.status = response.status ?? null;
            throw error;

        }

        return response.data;

    }

    async *stream(payload) {

        const url = `${this.config.baseUrl}/chat/completions`;

        const stream = await this.httpClient.stream(

            url,

            {

                headers: {

                    Authorization: `Bearer ${this.config.apiKey}`

                },

                body: payload

            }

        );

        yield* SSEParser.parse(stream);

    }

    async models() {

        const response = await this.httpClient.get(
            `${this.config.baseUrl}/models`,
            {
                headers: {
                    Authorization: `Bearer ${this.config.apiKey}`
                },
                timeout: this.config.timeout
            }
        );

        if (!response.success) {

            throw new Error(
                response.data?.error?.message ??
                response.error ??
                "Failed to list OpenRouter models."
            );

        }

        return response.data?.data ?? [];

    }

    /**
     * Tanpa API key, endpoint /models tetap balas 200 sehingga
     * cocok dipakai sebagai probe konektivitas murni.
     */
    async health() {

        const started = Date.now();

        const response = await this.httpClient.get(
            `${this.config.baseUrl}/models`,
            {
                headers: this.config.apiKey
                    ? { Authorization: `Bearer ${this.config.apiKey}` }
                    : {},
                timeout: 8000
            }
        );

        return {
            online: response.success === true,
            latency: Date.now() - started,
            authenticated: Boolean(this.config.apiKey),
            error: response.success
                ? null
                : (response.error ?? response.statusText ?? "unreachable")
        };

    }

}

module.exports = OpenRouterClient;