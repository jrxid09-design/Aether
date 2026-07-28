const conversations = new Map();

class MemoryRepository {
  get(sessionId) {
    return conversations.get(sessionId) || [];
  }

  save(sessionId, history) {
    conversations.set(sessionId, history);
  }

  delete(sessionId) {
    conversations.delete(sessionId);
  }
}

module.exports = new MemoryRepository();