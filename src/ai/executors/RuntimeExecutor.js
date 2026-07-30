const ToolExecutor = require("../tools/ToolExecutor");

/**
 * Menjalankan satu request AI sampai selesai, termasuk
 * loop tool-calling: model meminta tool -> tool dieksekusi ->
 * hasilnya dikembalikan ke model -> ulangi sampai model
 * menjawab tanpa tool call.
 */
class RuntimeExecutor {

    constructor(service, options = {}) {

        this.service = service;

        this.toolRegistry = null;

        this.toolExecutor = null;

        this.maxToolIterations =
            options.maxToolIterations ?? 10;

        this.events = options.events ?? null;

        this.logger = options.logger ?? null;

    }

    setToolRegistry(registry) {

        this.toolRegistry = registry;

        this.toolExecutor =
            new ToolExecutor(registry);

        return this;

    }

    async execute(request) {

        let iterations = 0;

        // Model gratis (dan kadang lokal saat sibuk) sesekali
        // membalas kosong — tanpa isi, tanpa tool call. Alih-alih
        // meneruskan hampa itu ke pengguna, coba ulang beberapa
        // kali; percobaan berikutnya biasanya berhasil.
        let emptyRetries = 0;
        const maxEmptyRetries = 2;

        while (iterations++ < this.maxToolIterations) {

            const response =
                await this.service.chat(request);

            if (!response.toolCalls?.length) {

                const isEmpty =
                    !response.content || !response.content.trim();

                if (isEmpty && emptyRetries < maxEmptyRetries) {

                    emptyRetries++;

                    // Percobaan kosong tidak dihitung sebagai iterasi
                    // tool, jadi loop tidak cepat habis.
                    iterations--;

                    await new Promise(resolve =>
                        setTimeout(resolve, 400 * emptyRetries)
                    );

                    continue;

                }

                return response;

            }

            if (!this.toolExecutor) {

                throw new Error(
                    "Model requested a tool call but no tool registry is configured."
                );

            }

            const results =
                await this.executeTools(response);

            this.appendToolMessages(

                request,

                response,

                results

            );

        }

        throw new Error(
            `Maximum tool iterations (${this.maxToolIterations}) exceeded.`
        );

    }

    async executeTools(response) {

        const results = [];

        for (const call of response.toolCalls) {

            this.events?.emit("tool:started", call);

            try {

                const result =
                    await this.toolExecutor.execute(call);

                this.events?.emit("tool:completed", result);

                results.push(result);

            }

            catch (error) {

                this.events?.emit("tool:failed", {
                    call,
                    error
                });

                // Kembalikan error ke model supaya bisa
                // memutuskan langkah berikutnya, bukan
                // menghentikan seluruh percakapan.
                results.push({

                    toolCallId: call.id,

                    name: call.name,

                    result: {
                        error: error.message
                    }

                });

            }

        }

        return results;

    }

    appendToolMessages(request, response, results) {

        request.messages.push({

            role: "assistant",

            content: response.content ?? "",

            tool_calls:

                response.toolCalls.map(call => ({

                    id: call.id,

                    type: "function",

                    function: {

                        name: call.name,

                        arguments:

                            JSON.stringify(

                                call.arguments

                            )

                    }

                }))

        });

        for (const result of results) {

            request.messages.push({

                role: "tool",

                tool_call_id:
                    result.toolCallId,

                name:
                    result.name,

                content:

                    typeof result.result === "string"

                        ? result.result

                        : JSON.stringify(result.result)

            });

        }

    }

    /**
     * Streaming yang MENDUKUNG tool.
     *
     * Streaming provider mentah tidak bisa memanggil tool di
     * tengah jalan, sehingga jalur suara/chat dulu tak bisa
     * memakai memori, forge, atau kalkulator sama sekali. Di sini
     * loop tool dijalankan penuh (non-stream) lalu jawaban akhir
     * dipancarkan bertahap — antarmuka tetap terasa "mengetik",
     * dan seluruh kemampuan tool ikut hidup.
     *
     * Untuk balasan panjang tanpa tool, ini menambah jeda sebelum
     * kata pertama; itu tebusan yang wajar demi tool berfungsi di
     * mana-mana (dan TTS toh mengucapkan kalimat utuh).
     */
    async *stream(request) {

        const AIStreamChunk = require("../models/AIStreamChunk");

        const response = await this.execute({
            ...request,
            stream: false
        });

        const text = response.content ?? "";

        // Pancarkan per potongan kata agar UI tetap animatif.
        const pieces = text.match(/\S+\s*/g) ?? [];

        for (const piece of pieces) {

            yield new AIStreamChunk({
                provider: response.provider,
                model: response.model,
                delta: piece,
                done: false
            });

            await new Promise(resolve => setTimeout(resolve, 12));

        }

        yield new AIStreamChunk({
            provider: response.provider,
            model: response.model,
            delta: "",
            toolCalls: response.toolCalls ?? [],
            finishReason: response.finishReason ?? "stop",
            done: true
        });

    }

}

module.exports = RuntimeExecutor;
