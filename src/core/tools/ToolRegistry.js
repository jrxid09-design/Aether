const { BaseRegistry } =
    require("../registry");

class ToolRegistry extends BaseRegistry {

    register(pluginId, tool) {

        const id =
            `${pluginId}.${tool.metadata.name}`;

        return super.register(
            id,
            tool
        );

    }

    describe() {

        return this.values().map(
            tool => tool.metadata
        );

    }

    execute(id, args = {}, context) {

        const tool =
            this.get(id);

        if (!tool) {

            throw new Error(
                `Tool '${id}' not found.`
            );

        }

        return tool.run(
            args,
            context
        );

    }

}

module.exports = new ToolRegistry();