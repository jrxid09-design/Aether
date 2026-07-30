class AIStreamChunk {

    constructor({

        id = null,

        model = null,

        provider = null,

        role = "assistant",

        delta = "",

        toolCalls = [],

        finishReason = null,

        done = false,

        raw = null

    } = {}) {

        this.id = id;

        this.model = model;

        this.provider = provider;

        this.role = role;

        this.delta = delta;

        this.finishReason = finishReason;

        this.done = done;

        this.raw = raw;

        this.toolCalls = toolCalls;

    }

}

module.exports = AIStreamChunk;