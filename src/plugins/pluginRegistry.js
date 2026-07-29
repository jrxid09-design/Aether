class PluginRegistry {

    constructor() {
        this.plugins = new Map();
    }

    register(plugin) {

        this.plugins.set(plugin.manifest.id, plugin);

    }

    get(id) {

        return this.plugins.get(id);

    }

    all() {

        return [...this.plugins.values()];

    }

    has(id) {

        return this.plugins.has(id);

    }

    remove(id) {

        this.plugins.delete(id);

    }

    clear() {

        this.plugins.clear();

    }

}

module.exports = new PluginRegistry();