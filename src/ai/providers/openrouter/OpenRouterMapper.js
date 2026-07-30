const AIResponse = require("../../models/AIResponse");
const AIStreamChunk = require("../../models/AIStreamChunk");
const AIToolCall = require("../../tools/AIToolCall");

class OpenRouterMapper {

    toRequest(request) {

        const payload = {

            model: request.model,

            messages: request.messages,

            temperature: request.temperature,

            max_tokens: request.maxTokens,

            stream: request.stream

        };

        if (request.tools?.length) {

            payload.tools = request.tools.map(tool => ({

                type: "function",

                function: {

                    name: tool.name,

                    description: tool.description,

                    parameters: tool.parameters

                }

            }));

        }

        if (request.toolChoice) {

            payload.tool_choice = request.toolChoice;

        }

        return Object.fromEntries(

            Object.entries(payload)

                .filter(([, value]) => value !== undefined)

        );

    }

    toResponse(data) {

        const choice = data.choices?.[0] ?? {};

        const message = choice.message ?? {};

        const toolCalls = (message.tool_calls ?? []).map(call =>

            new AIToolCall({

                id: call.id,

                name: call.function.name,

                arguments: JSON.parse(

                    call.function.arguments || "{}"

                )

            })

        );

        return new AIResponse({

            id: data.id,

            model: data.model,

            provider: "openrouter",

            role: message.role ?? "assistant",

            content: message.content ?? "",

            finishReason: choice.finish_reason,

            usage: {

                promptTokens:
                    data.usage?.prompt_tokens ?? 0,

                completionTokens:
                    data.usage?.completion_tokens ?? 0,

                totalTokens:
                    data.usage?.total_tokens ?? 0,

                reasoningTokens:
                    data.usage?.completion_tokens_details?.reasoning_tokens ?? 0

            },

            toolCalls,

            reasoning:
                message.reasoning ?? null,

            metadata: {

                created: data.created,

                fingerprint:
                    data.system_fingerprint,

                serviceTier:
                    data.service_tier

            },

            raw: data

        });

    }

    toStreamChunk(data) {

        const choice = data.choices?.[0] ?? {};

        const delta = choice.delta ?? {};

        return new AIStreamChunk({

            id: data.id,

            model: data.model,

            provider: "openrouter",

            role: delta.role ?? "assistant",

            delta: delta.content ?? "",

            toolCalls: delta.tool_calls ?? [],

            finishReason: choice.finish_reason,

            done: choice.finish_reason != null,

            raw: data

        });

    }

}

module.exports = OpenRouterMapper;