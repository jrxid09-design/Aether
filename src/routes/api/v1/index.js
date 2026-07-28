const express = require("express");
const response = require("../../../utils/response");
const systemController = require("../../../controllers/systemController");

const router = express.Router();
const { chatValidation } = require("../../../validators/chatValidator");
const validate = require("../../../middleware/validate");

router.post(
  "/chat",
  chatValidation,
  validate,
  (req, res) => {
    response.success(res, "Validation passed", {
      message: req.body.message,
    });
  }
);

router.get("/", (req, res) => {
  response.success(res, "Aether API v1");
});

router.get("/version", systemController.version);

module.exports = router;