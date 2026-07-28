const chatService = require("../services/chatService");
const response = require("../utils/response");

class ChatController {
  async chat(req, res, next) {
    try {
      // Sementara gunakan satu session untuk testing
      const sessionId = "default";

      const result = await chatService.chat(
        sessionId,
        req.body.message
      );

      return response.success(
        res,
        "Chat processed successfully",
        result
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ChatController();