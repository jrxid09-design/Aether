const express = require("express");
const response = require("../../../utils/response");
const systemController = require("../../../controllers/systemController");

const router = express.Router();

router.get("/", (req, res) => {
  response.success(res, "Aether API v1");
});

router.get("/version", systemController.version);

module.exports = router;