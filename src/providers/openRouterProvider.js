const axios = require("axios");

class OpenRouterProvider {
  async chat(messages) {
    try {
      const payload = {
        model: process.env.OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are Aether, a helpful, intelligent, and concise AI assistant.",
          },
          ...messages,
        ],
      };

      console.log("===== PAYLOAD =====");
      console.dir(payload, { depth: null });

      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("===== RESPONSE =====");
      console.dir(response.data, { depth: null });

      return {
        reply: response.data.choices[0].message.content,
        provider: "openrouter",
      };
    } catch (error) {
      console.error("OpenRouter Error:", error.response?.data);

      throw new Error(
        error.response?.data?.error?.message || error.message
      );
    }
  }
}

module.exports = new OpenRouterProvider();