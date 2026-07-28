const { body } = require("express-validator");

exports.chatValidation = [
  body("message")
    .trim()
    .notEmpty()
    .withMessage("Message is required")
    .isLength({ min: 2 })
    .withMessage("Message must be at least 2 characters"),
];