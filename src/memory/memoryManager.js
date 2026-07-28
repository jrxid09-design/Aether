const conversations = require("./conversationStore");

class MemoryManager {
  getHistory(sessionId) {
    return conversations.get(sessionId) || [];
  }

  addMessage(sessionId, role, content) {
    const history = this.getHistory(sessionId);

    history.push({
      role,
      content,
    });

    conversations.set(sessionId, history);
  }

  clear(sessionId) {
    conversations.delete(sessionId);
  }
}

module.exports = new MemoryManager();