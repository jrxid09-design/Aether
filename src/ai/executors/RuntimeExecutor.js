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

        while (iterations++ < this.maxToolIterations) {

            const response =
                await this.service.chat(request);

            if (!response.toolCalls?.length) {

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

    async *stream(request) {

        yield* this.service.stream(request);

    }

}

module.exports = RuntimeExecutor;
