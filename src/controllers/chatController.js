const chatService = require("../services/chatService");
const response = require("../utils/response");

class ChatController {
  async chat(req, res, next) {
    try {
      console.log("BODY:", req.body);

      const { sessionId, message } = req.body;

      console.log("SESSION:", sessionId);

      const result = await chatService.chat(
        sessionId,
        message
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