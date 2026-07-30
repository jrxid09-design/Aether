const { manager: integrations } = require("../integrations");
const telemetry = require("./telemetryService");

/**
 * AgentHub — menyatukan beberapa "pekerja" di bawah satu antarmuka.
 *
 * Aether bukan satu model saja; ia bisa mendelegasikan ke:
 *   - aether   : otak LLM lokal (reasoning + tool + memori)
 *   - openclaw : "tangan digital" — mengoperasikan aplikasi desktop
 *                yang tak punya API (klik, isi form, dsb)
 *   - hermes   : runtime agent untuk tugas berlapis
 *
 * OpenClaw & Hermes dipanggil lewat konektor integrasi yang sudah
 * ada. Karena instance sungguhannya belum bisa diverifikasi di sini,
 * pemanggilannya dibuat "gagal dengan anggun": agent offline
 * melaporkan status, bukan menjatuhkan orkestrasi.
 */
class AgentHub {

    /** Definisi semua agent yang bisa dipakai orkestrator. */
    agents() {

        return [
            {
                id: "aether",
                label: "Aether (LLM lokal)",
                kind: "reasoner",
                description:
                    "Menalar, menjawab, menulis, memakai memori & tool internal " +
                    "(kalkulasi, memori, filesystem, http, dst). Pilihan default " +
                    "untuk berpikir dan menyusun jawaban."
            },
            {
                id: "openclaw",
                label: "OpenClaw (otomasi desktop)",
                kind: "actuator",
                description:
                    "Mengoperasikan aplikasi desktop/website tanpa API: klik tombol, " +
                    "isi formulir, buka browser, tugas berulang di komputer. Pilih ini " +
                    "untuk AKSI pada antarmuka yang tak bisa dilakukan lewat kode biasa."
            },
            {
                id: "hermes",
                label: "Hermes (agent runtime)",
                kind: "agent",
                description:
                    "Menjalankan tugas agentik berlapis di runtime terpisah. Pilih ini " +
                    "untuk pekerjaan panjang yang lebih cocok didelegasikan ke agent khusus."
            }
        ];

    }

    describe() {
        return this.agents();
    }

    get(id) {
        return this.agents().find(a => a.id === id) ?? null;
    }

    /** Status kesiapan tiap agent (untuk UI & pemilihan rute). */
    async health() {

        const out = [];

        for (const agent of this.agents()) {

            if (agent.id === "aether") {
                out.push({ ...agent, online: true, detail: "runtime lokal" });
                continue;
            }

            const connector = integrations.get(agent.id);

            if (!connector) {
                out.push({ ...agent, online: false, detail: "tidak dikonfigurasi" });
                continue;
            }

            const snapshot = connector.lastStatus ?? {};

            out.push({
                ...agent,
                online: snapshot.online === true,
                detail: snapshot.online ? (connector.baseUrl ?? "") : (snapshot.error ?? "offline")
            });

        }

        return out;

    }

    /**
     * Jalankan satu tugas pada agent tertentu.
     * @returns {Promise<{ ok, agent, output, error? }>}
     */
    async run(agentId, task, { signal = null } = {}) {

        telemetry.publish("agent:run", { agent: agentId, task: String(task).slice(0, 80) });

        try {

            if (agentId === "aether") {
                return { ok: true, agent: agentId, output: await this.runAether(task) };
            }

            if (agentId === "openclaw" || agentId === "hermes") {
                return { ok: true, agent: agentId, output: await this.runConnector(agentId, task, signal) };
            }

            throw new Error(`Agent tidak dikenal: ${agentId}`);

        }

        catch (error) {

            telemetry.warn(`[agent] ${agentId} gagal: ${error.message}`);

            return { ok: false, agent: agentId, output: null, error: error.message };

        }

    }

    async runAether(task) {

        const aiRuntime = require("./aiRuntimeService");

        const response = await aiRuntime.chat({
            messages: [{ role: "user", content: String(task) }]
        });

        return response.content ?? "";

    }

    async runConnector(agentId, task, signal) {

        const connector = integrations.get(agentId);

        if (!connector) {
            throw new Error(`${agentId} belum dikonfigurasi di configs/integrations.json`);
        }

        if (connector.lastStatus?.online === false) {
            throw new Error(`${agentId} sedang offline (${connector.baseUrl})`);
        }

        if (typeof connector.chat !== "function") {
            throw new Error(`${agentId} tidak mendukung eksekusi tugas`);
        }

        // Konektor berbicara gaya OpenAI chat-completions; ambil teks
        // jawabannya. Bentuk lain ditangani apa adanya.
        const data = await connector.chat({
            messages: [{ role: "user", content: String(task) }],
            signal
        });

        return this.extractText(data);

    }

    extractText(data) {

        if (typeof data === "string") {
            return data;
        }

        return (
            data?.choices?.[0]?.message?.content ??
            data?.message?.content ??
            data?.content ??
            data?.output ??
            data?.result ??
            JSON.stringify(data)
        );

    }

}

module.exports = new AgentHub();
