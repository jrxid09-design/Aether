const response = require("../utils/response");

const aiRuntime = require("../services/aiRuntimeService");

const telemetry = require("../services/telemetryService");

class AIController {

    async providers(req, res, next) {

        try {
            return response.success(
                res,
                "AI providers",
                await aiRuntime.providers()
            );
        }
        catch (error) {
            next(error);
        }

    }

    async selectProvider(req, res, next) {

        try {

            const { id } = req.body;

            if (!id) {
                return response.error(res, "Field 'id' is required.", 400);
            }

            return response.success(res, "Provider switched", {
                active: aiRuntime.switchProvider(id)
            });

        }
        catch (error) {
            next(error);
        }

    }

    async models(req, res, next) {

        try {

            const provider = req.query.provider;

            return response.success(res, "Available models", {
                provider: provider ?? aiRuntime.ensure().activeProviderId,
                defaultModel: aiRuntime.defaultModel,
                models: await aiRuntime.models(provider)
            });

        }
        catch (error) {
            next(error);
        }

    }

    async selectModel(req, res, next) {

        try {

            const { model } = req.body;

            if (!model) {
                return response.error(res, "Field 'model' is required.", 400);
            }

            return response.success(res, "Default model updated", {
                defaultModel: aiRuntime.setDefaultModel(model)
            });

        }
        catch (error) {
            next(error);
        }

    }

    metrics(req, res, next) {

        try {
            return response.success(res, "AI metrics", aiRuntime.metrics());
        }
        catch (error) {
            next(error);
        }

    }

    async chat(req, res, next) {

        try {

            const { messages, model, temperature, maxTokens } = req.body;

            if (!Array.isArray(messages) || messages.length === 0) {
                return response.error(res, "Field 'messages' is required.", 400);
            }

            const result = await aiRuntime.chat({
                messages,
                model,
                temperature,
                maxTokens
            });

            return response.success(res, "Chat completed", result);

        }
        catch (error) {
            next(error);
        }

    }

    /**
     * Streaming lewat SSE.
     *
     * Error setelah header terkirim tidak bisa lagi jadi respons
     * HTTP 500, jadi dikirim sebagai event "error" agar klien
     * tetap tahu apa yang gagal alih-alih menggantung.
     */
    async stream(req, res) {

        const { messages, model, temperature, maxTokens } = req.body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return response.error(res, "Field 'messages' is required.", 400);
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        });

        const send = (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        let aborted = false;

        // Harus `res`, bukan `req`: pada Express 5 event "close"
        // milik req menyala segera setelah body selesai dibaca,
        // sehingga stream akan dikira dibatalkan sebelum token
        // pertama sempat datang.
        res.on("close", () => {
            aborted = true;
        });

        try {

            send("start", {
                provider: aiRuntime.ensure().activeProviderId,
                model: model ?? aiRuntime.defaultModel
            });

            for await (const chunk of aiRuntime.stream({
                messages,
                model,
                temperature,
                maxTokens
            })) {

                if (aborted) {
                    break;
                }

                send("chunk", {
                    delta: chunk.delta,
                    toolCalls: chunk.toolCalls,
                    done: chunk.done,
                    finishReason: chunk.finishReason
                });

            }

            if (!aborted) {
                send("done", { ok: true });
            }

        }

        catch (error) {

            telemetry.error(`Stream gagal: ${error.message}`);

            if (!aborted) {
                send("error", { message: error.message });
            }

        }

        finally {
            res.end();
        }

    }

}

module.exports = new AIController();
