const fs = require("fs");
const path = require("path");

const pluginRegistry = require("./pluginRegistry");
const pluginValidator = require("./pluginValidator");

const {
    ToolRegistry
} = require("../core/tools");

class PluginLoader {

    load(pluginRoot) {

        pluginRegistry.clear();
        ToolRegistry.clear();

        const folders = fs.readdirSync(pluginRoot);

        for (const folder of folders) {

            const pluginPath = path.join(
                pluginRoot,
                folder
            );

            if (!this.isPluginDirectory(pluginPath)) {
                continue;
            }

            try {

                const manifest =
                    this.loadManifest(pluginPath);

                const instance =
                    this.loadPlugin(
                        pluginPath,
                        manifest
                    );

                const tools =
                    this.collectTools(
                        pluginPath,
                        instance
                    );

                this.registerPlugin(
                    manifest,
                    instance
                );

                this.registerTools(
                    manifest,
                    tools
                );

                console.log(
                    `✓ Loaded Plugin : ${manifest.name}`
                );

            }
            catch (error) {

                console.error(
                    `✗ Failed Plugin : ${folder}`
                );

                console.error(error);

            }

        }

    }

    /**
     * Jalankan hook lifecycle `initialize()` untuk semua plugin
     * yang sudah ter-load. Dipisah dari load() karena load()
     * sinkron (dipanggil saat require app.js).
     */
    async initializeAll(context) {

        const { LifecycleManager } =
            require("../core/lifecycle");

        for (const { id, item } of pluginRegistry.list()) {

            try {

                await LifecycleManager.initialize(
                    item.instance,
                    context
                );

            }
            catch (error) {

                console.error(
                    `✗ Failed to initialize plugin : ${id}`
                );

                console.error(error);

            }

        }

    }

    isPluginDirectory(pluginPath) {

        return (
            fs.existsSync(pluginPath) &&
            fs.statSync(pluginPath).isDirectory() &&
            fs.existsSync(
                path.join(
                    pluginPath,
                    "manifest.json"
                )
            )
        );

    }

    loadManifest(pluginPath) {

        const manifest = JSON.parse(

            fs.readFileSync(

                path.join(
                    pluginPath,
                    "manifest.json"
                ),

                "utf8"

            )

        );

        pluginValidator.validate(manifest);

        return manifest;

    }

    loadPlugin(pluginPath, manifest) {

        const entryPath = path.join(
            pluginPath,
            manifest.entry
        );

        if (!fs.existsSync(entryPath)) {
            return {};
        }

        delete require.cache[
            require.resolve(entryPath)
        ];

        return require(entryPath);

    }

    /**
     * Tool sebuah plugin bisa datang dari dua tempat:
     * `index.js` yang mengekspor `tools: [...]` (sudah
     * ter-instansiasi), atau `tool.js` yang mengekspor array.
     * Keduanya digabung dan dideduplikasi berdasarkan nama.
     */
    collectTools(pluginPath, instance) {

        const tools = [];

        if (Array.isArray(instance?.tools)) {
            tools.push(...instance.tools);
        }

        // Beberapa plugin lama memakai `tool` (tunggal).
        if (instance?.tool) {
            tools.push(instance.tool);
        }

        tools.push(...this.loadTools(pluginPath));

        const seen = new Set();

        return tools.filter(tool => {

            const name = tool?.metadata?.name ?? tool?.name;

            if (!name || seen.has(name)) {
                return false;
            }

            seen.add(name);

            return true;

        });

    }

    loadTools(pluginPath) {

        const toolPath = path.join(
            pluginPath,
            "tool.js"
        );

        if (!fs.existsSync(toolPath)) {

            return [];

        }

        delete require.cache[
            require.resolve(toolPath)
        ];

        const tools = require(toolPath);

        return Array.isArray(tools)
            ? tools
            : [];

    }

    registerPlugin(manifest, instance) {

        pluginRegistry.register({

            manifest,

            instance

        });

    }

    registerTools(manifest, tools) {

        for (const tool of tools) {

            ToolRegistry.register(
                manifest.id,
                tool
            );

            console.log(
                `   └── ${manifest.id}.${
                    tool.metadata?.name ?? tool.name
                }`
            );

        }

    }

}

module.exports = new PluginLoader();