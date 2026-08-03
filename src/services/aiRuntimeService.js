const Aether = require("../ai");

const { AITool } = require("../ai/tools");

const { ToolRegistry } = require("../core/tools");

const telemetry = require("./telemetryService");

/**
 * Kurasi daftar model per platform: utamakan model GRATIS & yang
 * benar-benar bisa dipakai untuk chat, sembunyikan model non-chat
 * (embedding/tts/image/veo/imagen) dan buang prefix "models/" milik
 * Google. Daftar mentah tiap platform penuh jebakan (model usang yang
 * 404, model TTS/gambar), jadi kita saring + urutkan gratis-dulu.
 */
const RECOMMENDED_MODELS = {
    // Alias "*-latest" selalu menunjuk model flash terkini (gratis).
    google: [
        "gemini-flash-latest",
        "gemini-flash-lite-latest",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite"
    ],
    openrouter: [
        "deepseek/deepseek-chat-v3-0324:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemini-2.0-flash-exp:free",
        "qwen/qwen-2.5-72b-instruct:free"
    ],
    groq: [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant"
    ],
    openai: ["gpt-4o-mini"]
};

// Pola model BUKAN-chat (tak boleh dipilih untuk percakapan).
const NON_CHAT_MODEL =
    /embedding|embed|aqa|imagen|\bveo\b|-image|image-|native-audio|\btts\b|text-to-speech|whisper|learnlm|gemma-3n/i;

function isFreeModel(platform, id) {
    if (platform === "groq" || platform === "ollama") return true;
    if (platform === "openrouter") return id.endsWith(":free");
    if (platform === "google") return /flash/i.test(id) && !/pro/i.test(id);
    return false;
}

// Tingkat kematangan model, untuk pemeringkatan (stabil diutamakan).
const TIER_RANK = { stable: 0, preview: 1, experimental: 2, legacy: 3 };

function tier(id) {
    const s = String(id).toLowerCase();
    if (/preview/.test(s)) return "preview";
    if (/-exp\b|\bexp\b|experimental/.test(s)) return "experimental";
    if (/gemini-1\.5|gpt-3\.5|llama-2\b|gemma-2\b|-1\.0|text-bison|chat-bison/.test(s)) return "legacy";
    return "stable";
}

/**
 * Saring + peringkat daftar model mentah jadi daftar SIAP-PAKAI:
 *  - normalisasi id (buang prefix models/ Google)
 *  - buang non-chat (jaring pengaman regex; Google sudah difilter by capability)
 *  - buang model yang cache kesehatan tandai "bad" (dipelajari, bukan hardcoded)
 *  - lampirkan free/tier/status, urutkan: verified → rekomendasi → tier → free → abjad
 */
function curateModels(platform, rawModels = []) {

    const health = require("./modelHealthService");
    const rec = RECOMMENDED_MODELS[platform] ?? [];

    const seen = new Set();
    const list = [];

    for (const m of rawModels) {
        const id = platform === "google" ? String(m.id).replace(/^models\//, "") : m.id;
        if (!id || NON_CHAT_MODEL.test(id) || seen.has(id)) continue;
        if (health.isBad(platform, id)) continue;      // terbukti mati → sembunyikan
        seen.add(id);
        list.push({
            id,
            name: m.displayName ?? id,
            free: isFreeModel(platform, id),
            tier: tier(id),
            status: health.get(platform, id)?.status ?? "unknown"   // verified|quota|unknown
        });
    }

    const recRank = id => { const i = rec.indexOf(id); return i < 0 ? rec.length : i; };

    list.sort((a, b) =>
        (a.status === "verified" ? 0 : 1) - (b.status === "verified" ? 0 : 1) ||
        recRank(a.id) - recRank(b.id) ||
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        (a.free ? 0 : 1) - (b.free ? 0 : 1) ||
        a.id.localeCompare(b.id)
    );

    return list;
}

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
            "Bicaralah dengan hangat, tenang, ramah, dan manusiawi — seperti teman yang " +
            "menenangkan sekaligus dapat diandalkan, bukan robot yang kaku. Utamakan " +
            "solusi: pahami dulu maksud pengguna, beri jawaban yang menolong dan jelas, " +
            "serta langkah konkret bila dibutuhkan. Jawab ringkas dan tidak bertele-tele. " +
            "Ikuti bahasa pengguna: gunakan Bahasa Indonesia yang luwes, boleh santai dan " +
            "memakai dialek/logat lokal (mis. Sunda, Jawa, Betawi) bila pengguna " +
            "memakainya, agar terasa akrab — tetap sopan dan mudah dimengerti. Sesekali " +
            "boleh berempati singkat, tanpa berlebihan. Gunakan tool yang tersedia bila relevan.\n\n" +
            "Kamu punya memori jangka panjang. SEGERA simpan dengan memory_remember " +
            "setiap fakta pribadi baru begitu pengguna menyebutnya — tanpa diminta — " +
            "seperti nama, tanggal penting, hubungan keluarga, preferensi, perangkat & " +
            "ruangan di rumah, dan project yang sedang dikerjakan. Sebelum menjawab " +
            "pertanyaan yang menyinggung hal yang mungkin pernah dibicarakan (termasuk " +
            "pertanyaan yang MIRIP dengan sebelumnya), WAJIB memory_recall dulu supaya " +
            "jawabanmu konsisten dan tidak lupa. Jangan mengarang isi memori: kalau " +
            "tidak menemukan, katakan belum tahu.\n\n" +
            "Kamu bebas merangkai beberapa tool berturut-turut untuk menuntaskan satu " +
            "permintaan (mis. cari dulu, hitung, lalu simpan). Utamakan menyelesaikan " +
            "tugas secara nyata dengan tool, bukan sekadar menjelaskan caranya.\n\n" +
            "TERMINAL: untuk menjalankan proses/perintah (Hermes, Docker, npm, Python, " +
            "build, dll) JANGAN pernah membuat shell sementara. Pakai terminal_run atau " +
            "terminal_restart dengan `purpose` yang stabil (mis. 'hermes','docker') — " +
            "Aether akan memakai ulang terminal yang sudah ada atau membuat bila belum ada. " +
            "Untuk proses yang lama hidup, sertakan `expect` (regex) agar menunggu sampai " +
            "siap. Cek terminal_list dulu bila ragu, dan terminal_read untuk memeriksa log.\n\n" +
            "SKILL (kemampuan baru): kalau pengguna memintamu MEMBUAT skill/tool/plugin/" +
            "kemampuan baru — atau meminta sesuatu yang butuh kemampuan yang belum ada — " +
            "kamu WAJIB memakai tool create_tool untuk benar-benar membuatnya. JANGAN " +
            "menuliskan kode program di dalam balasan chat; itu bukan yang diminta. " +
            "Alurnya: (1) panggil create_tool — skill tersimpan sebagai DRAFT dan belum " +
            "aktif; (2) jelaskan singkat apa yang dilakukan skill itu lalu TANYA apakah " +
            "mau diaktifkan; (3) hanya bila pengguna setuju, panggil activate_tool. Kalau " +
            "pengguna menolak, biarkan tersimpan sebagai draft. Kamu bisa membuat skill " +
            "lewat percakapan mana pun (Console, Telegram, atau CLI).";

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

        // Tool kendali rumah (Home Assistant).
        builder.registerTools(require("./homeTools").homeTools());

        // Tool vision — Aether bisa "melihat" kamera/CCTV.
        builder.registerTools(require("./visionTools").visionTools());

        // Tool kirim media WhatsApp (aktif saat mengobrol di WhatsApp).
        builder.registerTools(require("./whatsappTools").whatsappTools());

        // Tool orang & wajah (Immich + face-match CCTV).
        builder.registerTools(require("./peopleTools").peopleTools());

        // Tool Terminal Runtime (jalankan/kelola proses di pty persisten).
        builder.registerTools(require("./terminalTools").terminalTools());

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

        for (const tool of require("./homeTools").homeTools()) {
            registry.register(tool);
        }

        for (const tool of require("./visionTools").visionTools()) {
            registry.register(tool);
        }

        for (const tool of require("./whatsappTools").whatsappTools()) {
            registry.register(tool);
        }

        for (const tool of require("./peopleTools").peopleTools()) {
            registry.register(tool);
        }

        for (const tool of require("./terminalTools").terminalTools()) {
            registry.register(tool);
        }

        for (const tool of require("./familyTools").familyTools()) {
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

    async models() {

        const platform = this.activePlatform?.id ?? "ollama";

        return this.discoverModels(platform);

    }

    /**
     * Temukan model siap-pakai untuk platform aktif. Google memakai
     * endpoint NATIVE (/v1beta/models) agar bisa menyaring by capability
     * (supportedGenerationMethods ∋ generateContent) — bukan tebak-tebakan
     * nama. Provider lain memakai daftar OpenAI-compatible.
     */
    async discoverModels(platform) {

        const resolved = this.activePlatform ?? {};

        let raw = [];

        try {
            if (platform === "google" && resolved.apiKey) {
                raw = await this.googleNativeModels(resolved.baseUrl, resolved.apiKey);
            }
            else {
                raw = await this.ensure().listModels();
            }
        }
        catch (error) {
            telemetry.warn(`[models] discovery gagal (${platform}): ${error.message}`);
            raw = [];
        }

        return curateModels(platform, raw);

    }

    /** Daftar model Google lewat endpoint native + kemampuannya. */
    async googleNativeModels(baseUrl, apiKey) {

        // baseUrl tersimpan ".../v1beta/openai" → native ".../v1beta".
        const base = String(baseUrl).replace(/\/openai\/?$/, "");

        const res = await fetch(
            `${base}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`,
            { signal: AbortSignal.timeout(15000) }
        );

        if (!res.ok) {
            throw new Error(`native models ${res.status}`);
        }

        const data = await res.json();

        return (data.models ?? [])
            .filter(m => (m.supportedGenerationMethods ?? []).includes("generateContent"))
            .map(m => ({ id: m.name, displayName: m.displayName }));

    }

    /**
     * Uji satu model dengan generateContent minimal. Perbarui cache
     * kesehatan. Dipakai saat menyimpan pilihan & tombol "Verifikasi".
     */
    async verifyModel(platform, id) {

        const health = require("./modelHealthService");
        const r = this.activePlatform ?? {};

        if (r.kind !== "openai") {
            return { ok: true };            // Ollama lokal: lewati uji jarak jauh
        }

        try {
            const res = await fetch(`${r.baseUrl}/chat/completions`, {
                method: "POST",
                headers: { Authorization: `Bearer ${r.apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: id, messages: [{ role: "user", content: "Hello" }], max_tokens: 1 }),
                signal: AbortSignal.timeout(20000)
            });

            if (res.ok) {
                health.mark(platform, id, "verified");
                return { ok: true, status: 200 };
            }

            const body = await res.json().catch(() => null);
            const message = (body?.[0]?.error?.message ?? body?.error?.message ?? "").slice(0, 140);
            const reason =
                res.status === 404 ? "tidak tersedia / usang" :
                res.status === 403 ? "izin ditolak" :
                res.status === 429 ? "kuota habis" : `http ${res.status}`;

            // 429 = sementara (kuota), jangan cap "bad" permanen.
            health.mark(platform, id, res.status === 429 ? "quota" : "bad", reason);
            return { ok: false, status: res.status, reason, message };
        }
        catch (error) {
            return { ok: false, reason: error.message };
        }

    }

    /** Verifikasi semua kandidat (OPT-IN dari UI — memakai kuota). */
    async verifyAll(platform) {
        const list = await this.discoverModels(platform);
        const results = [];
        for (const m of list) {
            results.push({ id: m.id, ...(await this.verifyModel(platform, m.id)) });
        }
        return { platform, results, models: await this.discoverModels(platform) };
    }

    /** Model peringkat-tertinggi yang belum ditandai mati. */
    async pickWorkingDefault(platform) {
        const list = await this.discoverModels(platform);
        return list[0]?.id ?? null;
    }

    /**
     * Tangani kegagalan model saat chat: tandai mati bila 404/403/410/
     * usang (429 = kuota, sementara), pilih pengganti terperingkat, simpan,
     * dan kembalikan id-nya untuk retry sekali. Null = jangan fallback.
     */
    async handleModelFailure(platform, model, err) {

        const health = require("./modelHealthService");
        const status = err?.status;
        const deprecated = /no longer available|not_?found|deprecated|is not supported|does not exist|not found/i
            .test(err?.message || "");

        if (status === 404 || status === 403 || status === 410 || deprecated) {
            health.mark(platform, model, "bad", status ? `http ${status}` : "deprecated");
        }
        else if (status === 429) {
            health.mark(platform, model, "quota", "kuota habis");
            // Limit harian free biasanya berbunyi "per-day"/"free-models-per-day".
            const daily = /per[-\s]?day|daily|free-models|quota/i.test(err?.message || "");
            try {
                const usage = require("./usageService");
                usage.recordError(platform);
                if (daily) usage.markLimited(platform);   // → alert + tandai, jadi bisa pindah provider
            }
            catch { /* abaikan */ }
        }
        else {
            return null;    // 5xx / jaringan → bukan salah model, jangan fallback
        }

        const list = await this.discoverModels(platform);
        const next = list.find(m => m.id !== model);

        if (next) {
            this.setDefaultModel(next.id);
            if (platform !== "ollama") {
                try { require("./providerConfigService").setProvider(platform, { model: next.id }); }
                catch { /* abaikan */ }
            }
            // Log terstruktur (Phase 8).
            telemetry.publish("ai:fallback", { provider: platform, from: model, status: status ?? null, to: next.id });
            telemetry.warn(
                `[AI fallback]\n  Provider: ${platform}\n  Requested Model: ${model}\n` +
                `  Status: ${status ?? "?"}\n  Reason: ${deprecated ? "model tidak tersedia" : "gagal"}\n` +
                `  Fallback: ${next.id}`
            );
        }

        return next?.id ?? null;

    }

    metrics() {

        return this.ensure().getMetrics();

    }

    /** AITool aktif saat ini (dipakai penyaringan berdasarkan peran). */
    tools() {
        try {
            const reg = this.ensure().runtime.getToolRegistry?.() ?? this.ensure().runtime.toolRegistry;
            return reg?.all?.() ?? [];
        }
        catch {
            return [];
        }
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

    /**
     * Pastikan ada model yang bisa dipakai. Provider cloud WAJIB
     * punya nama model; tanpa itu API menolak dengan pesan yang
     * membingungkan, jadi dicegat di sini dengan pesan jelas.
     */
    resolveModel(requested) {

        const model = requested || this.defaultModel || this.activePlatform?.model;

        if (!model && this.activePlatform?.kind === "openai") {
            const error = new Error(
                `Model belum dipilih untuk ${this.activePlatform.label}. ` +
                "Buka Settings → Provider AI, isi kolom Model (mis. gpt-4o-mini, " +
                "gemini-2.0-flash, atau llama-3.3-70b-versatile), lalu simpan."
            );
            error.code = "NO_MODEL";
            throw error;
        }

        return model;

    }

    async chat({ messages, model, temperature, maxTokens, tools }) {

        const msgs = await this.withMemory(messages);
        const platform = this.activePlatform?.id ?? "ollama";
        const first = this.resolveModel(model);

        try {
            const res = await this.ensure().chat({ messages: msgs, model: first, temperature, maxTokens, tools });
            this._recordUsage(platform, res);
            return res;
        }
        catch (error) {
            const next = await this.handleModelFailure(platform, first, error);
            if (!next) throw error;
            // Retry sekali dengan model pengganti (tanpa interaksi pengguna).
            const res = await this.ensure().chat({ messages: msgs, model: next, temperature, maxTokens, tools });
            this._recordUsage(this.activePlatform?.id ?? platform, res);
            return res;
        }

    }

    /** Catat pemakaian token per provider (best-effort; bentuk usage bervariasi). */
    _recordUsage(platform, res) {
        try {
            const u = res?.usage ?? res?.raw?.usage ?? {};
            require("./usageService").record(platform, {
                promptTokens: u.prompt_tokens ?? u.promptTokens ?? 0,
                completionTokens: u.completion_tokens ?? u.completionTokens ?? 0
            });
        }
        catch { /* pencatatan tak boleh menggagalkan chat */ }
    }

    async *stream({ messages, model, temperature, maxTokens, tools }) {

        const msgs = await this.withMemory(messages);
        const platform = this.activePlatform?.id ?? "ollama";
        const first = this.resolveModel(model);

        // Loop tool dijalankan penuh sebelum token pertama dipancarkan,
        // jadi kegagalan model muncul SEBELUM ada chunk keluar → aman
        // untuk fallback + retry tanpa dobel-output.
        try {
            yield* this.ensure().stream({ messages: msgs, model: first, temperature, maxTokens, tools, stream: true });
            try { require("./usageService").record(platform, {}); } catch { /* abaikan */ }
        }
        catch (error) {
            const next = await this.handleModelFailure(platform, first, error);
            if (!next) throw error;
            yield* this.ensure().stream({ messages: msgs, model: next, temperature, maxTokens, tools, stream: true });
            try { require("./usageService").record(this.activePlatform?.id ?? platform, {}); } catch { /* abaikan */ }
        }

    }

}

module.exports = new AIRuntimeService();
