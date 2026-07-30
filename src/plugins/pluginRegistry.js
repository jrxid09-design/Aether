const { BaseRegistry } =
    require("../core/registry");

class PluginRegistry extends BaseRegistry {

    register(plugin) {

        return super.register(

            plugin.manifest.id,

            plugin

        );

    }

}

module.exports = new PluginRegistry();