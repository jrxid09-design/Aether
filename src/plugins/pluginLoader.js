const fs = require("fs");
const path = require("path");

const pluginRegistry = require("./pluginRegistry");
const pluginValidator = require("./pluginValidator");
const toolIndex = require("./toolIndex");

class PluginLoader {

    load(pluginRoot) {

        pluginRegistry.clear();
        toolIndex.clear();

        const folders = fs.readdirSync(pluginRoot);

        for (const folder of folders) {

            const pluginPath = path.join(pluginRoot, folder);

            if (!fs.statSync(pluginPath).isDirectory())
                continue;

            const manifestPath = path.join(
                pluginPath,
                "manifest.json"
            );

            if (!fs.existsSync(manifestPath))
                continue;

            const manifest = JSON.parse(
                fs.readFileSync(manifestPath, "utf8")
            );

            pluginValidator.validate(manifest);

            const entryPath = path.join(
                pluginPath,
                manifest.entry
            );

            // Bersihkan cache saat development
            delete require.cache[
                require.resolve(entryPath)
            ];

            const instance = require(entryPath);

            if (
                !instance ||
                !Array.isArray(instance.tools)
            ) {
                console.warn(
                    `Skip Plugin : ${folder} (belum dimigrasikan)`
                );
                continue;
            }

            pluginRegistry.register({
                manifest,
                instance
            });

            for (const tool of instance.tools) {

                toolIndex.register(
                    tool.name,
                    manifest.id
                );

            }

            console.log(
                `Loaded Plugin : ${manifest.name}`
            );

        }

    }

}

module.exports = new PluginLoader();