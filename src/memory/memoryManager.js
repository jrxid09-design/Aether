const conversations = require("./conversationStore");
const { MAX_HISTORY_MESSAGES } = require("../config/constants");

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

if (history.length > MAX_HISTORY_MESSAGES) {
  history.shift();
}

conversations.set(sessionId, history);
  }

  clear(sessionId) {
    conversations.delete(sessionId);
  }
}

module.exports = new MemoryManager();