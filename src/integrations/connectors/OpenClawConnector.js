const AgentConnector = require("./AgentConnector");

/**
 * Konektor untuk OpenClaw.
 *
 * Port dan path di bawah adalah default yang bisa ditimpa lewat
 * configs/integrations.json. Setelah instance OpenClaw benar-benar
 * berjalan, kunci `paths.health` / `paths.chat` ke nilai yang
 * terbukti agar Aether tidak perlu menebak tiap probe.
 */
class OpenClawConnector extends AgentConnector {

    constructor(options = {}) {

        super({
            label: "OpenClaw",
            baseUrl: "http://localhost:18789",
            ...options,
            id: options.id ?? "openclaw",
            healthCandidates: options.healthCandidates ?? [
                "/api/health",
                "/health",
                "/healthz",
                "/api/status",
                "/"
            ]
        });

    }

    async listTools() {

        const path = this.paths.tools ?? "/api/tools";

        const response = await this.httpClient.get(this.url(path), {
            headers: this.requestHeaders(),
            timeout: this.timeout
        });

        if (!response.success) {
            return [];
        }

        const data = response.data;

        return Array.isArray(data) ? data : (data?.tools ?? []);

    }

}

module.exports = OpenClawConnector;
