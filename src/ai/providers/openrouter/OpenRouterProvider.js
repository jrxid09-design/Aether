const BaseAIProvider = require("../BaseAIProvider");

const OpenRouterClient = require("./OpenRouterClient");
const OpenRouterMapper = require("./OpenRouterMapper");

class OpenRouterProvider extends BaseAIProvider {

    constructor({

        httpClient,

        config,

        mapper = new OpenRouterMapper()

    } = {}) {

        super();

        this.mapper = mapper;

        this.client = new OpenRouterClient({

            httpClient,

            config

        });

    }

    get id() {

        return "openrouter";

    }

    async chat(request) {

        const payload = this.mapper.toRequest(request);

        const data = await this.client.chat(payload);

        return this.mapper.toResponse(data);

    }
    async *stream(request) {

    const payload = this.mapper.toRequest(request);

    payload.stream = true;

    for await (const chunk of this.client.stream(payload)) {

        yield this.mapper.toStreamChunk(chunk);

    }

    }

    async health() {

        return this.client.health();

    }

    async listModels() {

        const models = await this.client.models();

        return models.map(model => ({

            id: model.id,

            name: model.name ?? model.id,

            provider: "openrouter",

            contextLength: model.context_length ?? null,

            pricing: model.pricing ?? null

        }));

    }

}

module.exports = OpenRouterProvider;