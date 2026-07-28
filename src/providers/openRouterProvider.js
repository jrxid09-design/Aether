const axios = require("axios");

const aiConfig = require("../config/ai");
const systemPrompt = require("../config/systemPrompt");

class OpenRouterProvider {
  async chat(messages) {
    try {
      const payload = {
        model: aiConfig.model,

        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...messages,
        ],

        temperature: aiConfig.temperature,
        max_tokens: aiConfig.maxTokens,
      };

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        payload,
        {
          timeout: aiConfig.timeout,
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      const reply = response.data?.choices?.[0]?.message?.content;

      if (!reply) {
        console.error("Unexpected OpenRouter response:");
        console.dir(response.data, { depth: null });

        throw new Error("OpenRouter returned an empty response.");
      }

      return {
        reply,
        provider: "openrouter",
      };
    } catch (error) {
      console.error(
        "OpenRouter Error:",
        error.response?.data || error.message
      );

      throw new Error(
        error.response?.data?.error?.message || error.message
      );
    }
  }
}

module.exports = new OpenRouterProvider();