const aiProvider = require("../providers/aiProvider");
const memory = require("../memory/memoryManager");

class ChatService {
  async chat(sessionId, message) {
    memory.addMessage(sessionId, "user", message);

    const history = memory.getHistory(sessionId);

    console.log("===== HISTORY =====");
    console.dir(history, { depth: null });

    const result = await aiProvider.chat(history);

    memory.addMessage(sessionId, "assistant", result.reply);

    console.log("===== AFTER AI =====");
    console.dir(memory.getHistory(sessionId), { depth: null });

    return result;
  }
}

module.exports = new ChatService();