const response = require("../utils/response");
const chatService = require("../services/chatService");

exports.chat = async (req, res, next) => {
  try {
    const result = await chatService.chat(req.body.message);

    response.success(res, "Chat processed successfully", result);
  } catch (err) {
    next(err);
  }
};