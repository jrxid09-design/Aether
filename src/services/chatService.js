const axios = require("axios");

class ChatService {
  async chat(message) {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openrouter/free",
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return {
      reply: response.data.choices[0].message.content,
      provider: "OpenRouter",
    };
  }
}

module.exports = new ChatService();