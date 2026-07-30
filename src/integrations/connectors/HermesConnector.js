const AgentConnector = require("./AgentConnector");

/**
 * Konektor untuk hermes-agent.
 *
 * Sama seperti OpenClaw, default di sini adalah tebakan yang
 * masuk akal untuk agent server dan dimaksudkan untuk ditimpa
 * lewat configs/integrations.json begitu instance-nya nyata.
 */
class HermesConnector extends AgentConnector {

    constructor(options = {}) {

        super({
            label: "Hermes Agent",
            baseUrl: "http://localhost:8080",
            ...options,
            id: options.id ?? "hermes",
            healthCandidates: options.healthCandidates ?? [
                "/health",
                "/healthz",
                "/api/health",
                "/v1/models",
                "/"
            ]
        });

    }

    async listModels() {

        const path = this.paths.models ?? "/v1/models";

        const response = await this.httpClient.get(this.url(path), {
            headers: this.requestHeaders(),
            timeout: this.timeout
        });

        if (!response.success) {
            return [];
        }

        const data = response.data;

        const models = Array.isArray(data) ? data : (data?.data ?? data?.models ?? []);

        return models.map(model => ({
            id: model.id ?? model.name,
            name: model.name ?? model.id
        }));

    }

}

module.exports = HermesConnector;
