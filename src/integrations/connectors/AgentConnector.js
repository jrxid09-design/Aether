const BaseConnector = require("../BaseConnector");

/**
 * Konektor generik untuk agent eksternal berbasis HTTP.
 *
 * Endpoint tiap agent berbeda-beda dan bisa berubah antar versi,
 * jadi alih-alih mengunci satu path, konektor ini mencoba
 * beberapa kandidat health path lalu MENGINGAT mana yang berhasil.
 * Path hasil temuan dilaporkan ke UI sehingga bisa dikunci lewat
 * konfigurasi bila sudah pasti.
 */
class AgentConnector extends BaseConnector {

    constructor(options = {}) {

        super({
            kind: "agent",
            ...options
        });

        /** Kandidat path health, terurut dari yang paling spesifik. */
        this.healthCandidates =
            options.healthCandidates ?? [
                "/health",
                "/healthz",
                "/api/health",
                "/status",
                "/api/status",
                "/"
            ];

        // Path yang dikonfigurasi eksplisit selalu dicoba pertama.
        if (this.paths.health) {
            this.healthCandidates = [
                this.paths.health,
                ...this.healthCandidates.filter(p => p !== this.paths.health)
            ];
        }

        /** Diisi setelah probe pertama yang berhasil. */
        this.resolvedHealthPath = null;

    }

    async probe() {

        const candidates = this.resolvedHealthPath
            ? [this.resolvedHealthPath]
            : this.healthCandidates;

        let lastError = "unreachable";

        for (const path of candidates) {

            const started = Date.now();

            const response = await this.httpClient.get(this.url(path), {
                headers: this.requestHeaders(),
                timeout: this.timeout
            });

            if (response.success) {

                this.resolvedHealthPath = path;

                return {

                    online: true,

                    latency: Date.now() - started,

                    version: this.readVersion(response.data),

                    detail: {

                        healthPath: path,

                        payload:
                            typeof response.data === "object" && response.data !== null
                                ? response.data
                                : { raw: String(response.data ?? "").slice(0, 200) }

                    }

                };

            }

            lastError =
                response.error ??
                response.statusText ??
                `HTTP ${response.status}`;

            // 401/403 berarti servicenya HIDUP, hanya butuh kredensial.
            if (response.status === 401 || response.status === 403) {

                this.resolvedHealthPath = path;

                return {
                    online: true,
                    latency: Date.now() - started,
                    detail: {
                        healthPath: path,
                        authRequired: true
                    },
                    error: "authentication required"
                };

            }

        }

        return {
            online: false,
            latency: null,
            error: lastError,
            detail: {
                triedPaths: candidates
            }
        };

    }

    readVersion(data) {

        if (!data || typeof data !== "object") {
            return null;
        }

        return data.version ?? data.build ?? data.commit ?? null;

    }

    /**
     * Kirim prompt ke agent. Bentuk payload sengaja mengikuti
     * gaya OpenAI chat-completions karena itu yang paling umum
     * dipakai agent server; override di turunan bila berbeda.
     */
    async chat({ messages, model = null, ...rest }) {

        const path = this.paths.chat ?? "/v1/chat/completions";

        const response = await this.httpClient.post(this.url(path), {
            headers: this.requestHeaders(),
            body: {
                model: model ?? this.metadata.defaultModel ?? undefined,
                messages,
                ...rest
            },
            timeout: this.metadata.chatTimeout ?? 120000
        });

        if (!response.success) {

            throw new Error(
                response.data?.error?.message ??
                response.error ??
                response.statusText ??
                `${this.label} request failed.`
            );

        }

        return response.data;

    }

}

module.exports = AgentConnector;
