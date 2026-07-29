const aiProvider = require("../providers/aiProvider");
const memory = require("../memory/memoryManager");

class ChatService {
  async chat(sessionId, message) {
    await memory.addMessage(sessionId, "user", message);

    const history = await memory.getHistory(sessionId);

    const result = await aiProvider.chat(history);

    await memory.addMessage(sessionId, "assistant", result.reply);

    return result;
  }
}

module.exports = new ChatService();