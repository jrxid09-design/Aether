const BaseAIProvider = require("../BaseAIProvider");

const OllamaMapper = require("./OllamaMapper");

/**
 * Provider untuk AI lokal yang dijalankan Ollama.
 *
 * Berbeda dengan provider cloud, provider ini juga membuka
 * kemampuan operasional (daftar model, model yang sedang
 * dimuat, unduh model) supaya Aether Console bisa mengelola
 * runtime lokal tanpa perlu terminal.
 */
class OllamaProvider extends BaseAIProvider {

    constructor({
        client,
        mapper = new OllamaMapper(),
        context
    } = {}) {

        super(context);

        if (!client) {
            throw new Error("OllamaClient is required.");
        }

        this.client = client;

        this.mapper = mapper;

    }

    get id() {

        return "ollama";

    }

    async chat(request) {

        const payload = this.mapper.toRequest(request);

        payload.stream = false;

        const data = await this.client.chat(payload);

        return this.mapper.toResponse(data, {
            model: request.model
        });

    }

    async *stream(request) {

        const payload = this.mapper.toRequest(request);

        payload.stream = true;

        for await (const chunk of this.client.stream(payload)) {

            yield this.mapper.toStreamChunk(chunk, {
                model: request.model
            });

        }

    }

    // ---- Kemampuan operasional ----------------------------------

    async health() {

        return this.client.health();

    }

    /** Model yang ter-install, sudah dinormalisasi. */
    async listModels() {

        const models = await this.client.tags();

        return models.map(model => ({

            id: model.name ?? model.model,

            name: model.name ?? model.model,

            provider: "ollama",

            size: model.size ?? null,

            digest: model.digest ?? null,

            family: model.details?.family ?? null,

            parameterSize: model.details?.parameter_size ?? null,

            quantization: model.details?.quantization_level ?? null,

            modifiedAt: model.modified_at ?? null

        }));

    }

    /** Model yang sedang menempati RAM/VRAM. */
    async listLoadedModels() {

        const models = await this.client.ps();

        return models.map(model => ({

            id: model.name ?? model.model,

            name: model.name ?? model.model,

            size: model.size ?? null,

            sizeVram: model.size_vram ?? 0,

            expiresAt: model.expires_at ?? null

        }));

    }

    async showModel(model) {

        return this.client.show(model);

    }

    /** Unduh model; menghasilkan progress bertahap. */
    async *pullModel(model) {

        yield* this.client.pull(model);

    }

    async embed(model, input) {

        return this.client.embed(model, input);

    }

}

module.exports = OllamaProvider;
