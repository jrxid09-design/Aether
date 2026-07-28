const express = require("express");
const response = require("../utils/response");
const systemController = require("../controllers/systemController");

const router = express.Router();

router.get("/", systemController.home);

router.get("/health", systemController.health);

router.get("/api", (req, res) => {
  response.success(res, "Aether API");
});

router.get("/api/version", systemController.version);

module.exports = router;