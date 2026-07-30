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
                const {
                        LifecycleManager
                    } = require("../core/lifecycle");

                    await LifecycleManager.initialize(
                                  instance
                                );

                const tools =
                    this.loadTools(
                        pluginPath
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
                `   └── ${manifest.id}.${tool.metadata.name}`
            );

        }

    }

}

module.exports = new PluginLoader();