class ToolExecutor {

    constructor(registry) {

        this.registry = registry;

    }

    async execute(call) {

        const tool = this.registry.get(call.name);

        if (!tool) {

            throw new Error(`Tool '${call.name}' not found.`);

        }

        const result = await tool.execute(call.arguments);

        return {

            toolCallId: call.id,

            name: call.name,

            result

        };

    }

}

module.exports = ToolExecutor;