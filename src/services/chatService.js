const aiProvider = require("../providers/aiProvider");

class ChatService {
  async chat(message) {
    return aiProvider.chat(message);
  }
}

module.exports = new ChatService();