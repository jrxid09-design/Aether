const AgentPhase = require("../runtime/agentPhase");

class Reasoner extends AgentPhase {

    async run(state) {

        // Untuk sementara gunakan response lama dari provider
        // Nanti kita refactor ke LLMClient.

        state.response = await this.reason(state);

    }

    async reason(state) {

        // TODO:
        // sementara hanya placeholder

        return {
            reply: "Reasoner is working.",
            provider: "reasoner"
        };

    }

}

module.exports = Reasoner;