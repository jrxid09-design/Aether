const repository = require("../repositories/sqliteMemoryRepository");
const { MAX_HISTORY_MESSAGES } = require("../config/constants");

class MemoryManager {
  async getHistory(sessionId) {
    return await repository.get(sessionId);
  }

  async addMessage(sessionId, role, content) {
    const history = await repository.get(sessionId);

    if (history.length >= MAX_HISTORY_MESSAGES) {
      await repository.clear(sessionId);

      const trimmed = history.slice(-(MAX_HISTORY_MESSAGES - 1));

      for (const message of trimmed) {
        await repository.save(sessionId, message);
      }
    }

    await repository.save(sessionId, {
      role,
      content,
    });
  }

  async clear(sessionId) {
    await repository.clear(sessionId);
  }
}

module.exports = new MemoryManager();