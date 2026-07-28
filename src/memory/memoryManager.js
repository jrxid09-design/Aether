const repository = require("../repositories/memoryRepository");
const { MAX_HISTORY_MESSAGES } = require("../config/constants");

class MemoryManager {
  getHistory(sessionId) {
    return repository.get(sessionId);
  }

  addMessage(sessionId, role, content) {
    const history = repository.get(sessionId);

    history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });

    if (history.length > MAX_HISTORY_MESSAGES) {
      history.shift();
    }

    repository.save(sessionId, history);
  }

  clear(sessionId) {
    repository.delete(sessionId);
  }
}

module.exports = new MemoryManager();