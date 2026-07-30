const Aether = require("../ai");

const { AITool } = require("../ai/tools");

const { ToolRegistry } = require("../core/tools");

const telemetry = require("./telemetryService");

/**
 * Satu-satunya pemilik AIEngine untuk proses daemon.
 *
 * Tugasnya menjembatani tiga dunia: konfigurasi (env), tool
 * plugin, dan AI runtime — supaya controller HTTP cukup
 * memanggil metode di sini tanpa tahu cara engine dirakit.
 */
class AIRuntimeService {

    constructor() {

        this.engine = null;

        this.systemPrompt =
            "Kamu adalah Aether, asisten AI pribadi yang berjalan di perangkat milik pengguna. " +
            "Jawab ringkas dan langsung ke inti, dalam bahasa yang dipakai pengguna. " +
            "Gunakan tool yang tersedia bila relevan.\n\n" +
            "Kamu punya memori jangka panjang. Simpan dengan memory_remember hal yang " +
            "berguna diingat lain waktu — identitas dan kebiasaan pemilik, perangkat dan " +
            "ruangan di rumah, project yang sedang dikerjakan — dan cari dengan " +
            "memory_recall sebelum menjawab pertanyaan yang menyinggung hal yang pernah " +
            "dibicarakan. Jangan mengarang isi memori: kalau tidak menemukan, katakan " +
            "belum tahu.\n\n" +
            "Kamu bebas merangkai beberapa tool berturut-turut untuk menuntaskan satu " +
            "permintaan (mis. cari dulu, hitung, lalu simpan). Kalau kemampuan yang " +
            "dibutuhkan belum ada, kamu boleh membuatnya sendiri lewat create_tool. " +
            "Utamakan menyelesaikan tugas secara nyata dengan tool, bukan sekadar " +
            "menjelaskan caranya.";

    }

    /**
     * Rakit engine dari konfigurasi provider (bukan lagi .env
     * langsung). Aman dipanggil ulang — dipakai reconfigure()
     * saat pengguna mengganti API key/platform dari Settings.
     */
    initialize() {

        const providerConfig = require("./providerConfigService");

        const resolved = providerConfig.resolveActive();

        const builder = new Aether.Builder();

        // Ollama selalu terdaftar sebagai jaring pengaman lokal.
        const ollamaCfg = providerConfig.read().ollama ?? {};

        builder.ollama({
            baseUrl: ollamaCfg.baseUrl || "http://localhost:11434",
            timeout: 120000
        });

        if (resolved.kind === "openai") {

            // Satu jalur OpenAI-compatible untuk platform apa pun.
            builder.provider("openai", {
                apiKey: resolved.apiKey,
                baseUrl: resolved.baseUrl,
                providerId: resolved.id,
                timeout: 120000
            });

            builder.use("openai");

        }
        else {
            builder.use("ollama");
        }

        if (resolved.model) {
            builder.defaultModel(resolved.model);
        }
        else if (resolved.kind === "ollama") {
            builder.defaultModel(ollamaCfg.model || "llama3.2");
        }

        builder.registerTools(this.bridgePluginTools());

        // Tool memori didaftarkan langsung (bukan lewat plugin)
        // karena memori adalah bagian inti Aether, bukan kemampuan
        // opsional yang bisa dicabut.
        builder.registerTools(require("../memory/tools").memoryTools());

        // Tool "forge" — kemampuan Aether menambah kemampuannya
        // sendiri lewat percakapan.
        builder.registerTools(require("./forgeTools").forgeTools());

        this.engine = builder.build();

        this.activePlatform = resolved;

        this.attachEvents();

        telemetry.info(
            `AI runtime siap (platform=${resolved.label}, model=${resolved.model ?? "default"})` +
            (resolved.fellBackFrom
                ? ` — key ${resolved.fellBackFrom} kosong, pakai Ollama`
                : "")
        );

        return this;

    }

    /**
     * Bungkus tool plugin menjadi AITool agar bisa dipanggil model.
     *
     * Nama tool memakai "__" sebagai pemisah karena banyak model
     * menolak titik pada nama fungsi, sementara id internal Aether
     * berbentuk "plugin.tool".
     */
    bridgePluginTools() {

        return ToolRegistry.describe().map(descriptor =>

            new AITool({

                name: descriptor.id.replace(/\./g, "__"),

                description:
                    descriptor.description ||
                    `Tool ${descriptor.id} dari plugin ${descriptor.pluginId}.`,

                parameters: this.toJsonSchema(descriptor.parameters),

                execute: async (args) => {

                    telemetry.publish("tool:invoked", {
                        tool: descriptor.id,
                        args
                    });

                    try {

                        const result = await ToolRegistry.execute(
                            descriptor.id,
                            args,
                            { source: "ai" }
                        );

                        telemetry.publish("tool:result", {
                            tool: descriptor.id,
                            ok: true
                        });

                        return result;

                    }

                    catch (error) {

                        telemetry.publish("tool:result", {
                            tool: descriptor.id,
                            ok: false,
                            error: error.message
                        });

                        throw error;

                    }

                }

            })

        );

    }

    /**
     * Parameter plugin ditulis sebagai peta sederhana
     * ({ city: { type, description, required } }), sedangkan
     * model butuh JSON Schema utuh.
     */
    toJsonSchema(parameters = {}) {

        const properties = {};

        const required = [];

        for (const [key, spec] of Object.entries(parameters)) {

            const { required: isRequired, ...rest } = spec ?? {};

            properties[key] = {
                type: "string",
                ...rest
            };

            if (isRequired) {
                required.push(key);
            }

        }

        const schema = {
            type: "object",
            properties
        };

        if (required.length) {
            schema.required = required;
        }

        return schema;

    }

    /**
     * Bangun ulang engine dari konfigurasi terkini. Dipanggil saat
     * pengguna mengganti API key / platform lewat Settings — tanpa
     * merestart daemon.
     */
    reconfigure() {

        this.initialize();

        const resolved = this.activePlatform;

        telemetry.publish("ai:reconfigured", {
            platform: resolved.label,
            model: resolved.model
        });

        return {
            platform: resolved.label,
            kind: resolved.kind,
            model: resolved.model,
            fellBackFrom: resolved.fellBackFrom ?? null
        };

    }

    attachEvents() {

        const emitter = this.engine.getEventEmitter();

        for (const type of ["tool:started", "tool:completed", "tool:failed"]) {

            emitter.on(type, payload => {
                telemetry.publish(type, payload);
            });

        }

        // Langganan forge dipasang SEKALI saja pada telemetry global,
        // supaya reconfigure() tidak menumpuk listener.
        if (this.forgeSubscribed) {
            return;
        }

        this.forgeSubscribed = true;

        // Saat forge menamb/menghapus tool, segarkan daftar tool
        // yang dilihat model — kalau tidak, tool baru buatan Aether
        // baru terlihat setelah restart.
        telemetry.on("event", event => {
            if (event?.type === "forge:changed") {
                try {
                    this.refreshTools();
                }
                catch (error) {
                    telemetry.warn(`[forge] refresh tool gagal: ${error.message}`);
                }
            }
        });

    }

    /** Rakit ulang registry tool AI dari keadaan terkini. */
    refreshTools() {

        if (!this.engine) {
            return 0;
        }

        const { AIToolRegistry } = require("../ai/tools");

        const registry = new AIToolRegistry();

        for (const tool of this.bridgePluginTools()) {
            registry.register(tool);
        }

        for (const tool of require("../memory/tools").memoryTools()) {
            registry.register(tool);
        }

        for (const tool of require("./forgeTools").forgeTools()) {
            registry.register(tool);
        }

        this.engine.runtime.setToolRegistry(registry);

        return registry.all().length;

    }

    ensure() {

        if (!this.engine) {
            this.initialize();
        }

        return this.engine;

    }

    // ---- Operasi yang dipakai controller -------------------------

    async providers() {

        const engine = this.ensure();

        const health = await engine.healthAll();

        return {
            active: engine.activeProviderId,
            providers: health
        };

    }

    switchProvider(id) {

        const engine = this.ensure();

        engine.use(id);

        telemetry.info(`Provider AI dialihkan ke "${id}"`);

        return engine.activeProviderId;

    }

    setDefaultModel(model) {

        this.ensure().runtime.setDefaultModel(model);

        telemetry.info(`Model default diubah ke "${model}"`);

        return model;

    }

    get defaultModel() {

        return this.ensure().runtime.options.defaultModel;

    }

    async models(provider) {

        return this.ensure().listModels(provider);

    }

    metrics() {

        return this.ensure().getMetrics();

    }

    /** Sisipkan system prompt bila pemanggil belum menyediakannya. */
    withSystemPrompt(messages = []) {

        if (messages.some(message => message.role === "system")) {
            return messages;
        }

        return [
            { role: "system", content: this.systemPrompt },
            ...messages
        ];

    }

    /**
     * Ambil memori relevan lalu tempelkan ke system prompt.
     *
     * Ini yang membuat Aether tidak perlu dijelaskan ulang setiap
     * percakapan. Model tetap punya tool memory_recall untuk
     * menggali lebih dalam; injeksi ini hanya menyediakan konteks
     * awal supaya jawaban pertama pun sudah nyambung.
     *
     * Kegagalan di sini tidak boleh menggagalkan chat — tanpa
     * memori Aether cuma jadi kurang tahu, bukan rusak.
     */
    async withMemory(messages = []) {

        const withPrompt = this.withSystemPrompt(messages);

        const lastUser = [...withPrompt]
            .reverse()
            .find(message => message.role === "user");

        if (!lastUser?.content || typeof lastUser.content !== "string") {
            return withPrompt;
        }

        try {

            const memory = require("../memory/services/MemoryService");

            const context = await memory.buildContext(lastUser.content, {
                limit: 8,
                maxChars: 1800
            });

            if (!context.text) {
                return withPrompt;
            }

            telemetry.publish("memory:injected", {
                memories: context.memoryCount,
                documents: context.documentCount,
                strategies: context.strategies
            });

            return withPrompt.map((message, index) =>

                index === withPrompt.findIndex(m => m.role === "system")

                    ? {
                        ...message,
                        content:
                            `${message.content}\n\n` +
                            `Berikut yang kamu ingat dan mungkin relevan. ` +
                            `Gunakan bila membantu, jangan sebutkan bahwa ini "memori" ` +
                            `kecuali ditanya, dan jangan mengarang bila tidak ada.\n\n` +
                            context.text
                    }

                    : message

            );

        }

        catch (error) {

            telemetry.warn(`[memory] injeksi konteks gagal: ${error.message}`);

            return withPrompt;

        }

    }

    async chat({ messages, model, temperature, maxTokens, tools }) {

        return this.ensure().chat({
            messages: await this.withMemory(messages),
            model,
            temperature,
            maxTokens,
            tools
        });

    }

    async *stream({ messages, model, temperature, maxTokens, tools }) {

        yield* this.ensure().stream({
            messages: await this.withMemory(messages),
            model,
            temperature,
            maxTokens,
            tools,
            stream: true
        });

    }

}

module.exports = new AIRuntimeService();
