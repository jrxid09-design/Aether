const express = require("express");
const response = require("../utils/response");
const systemController = require("../controllers/systemController");

const router = express.Router();

const AppError = require("../errors/AppError");

router.get("/error", (req, res, next) => {
  next(new AppError("Testing Global Error Handler", 500));
});

router.get("/", systemController.home);

router.get("/health", systemController.health);

router.get("/api", (req, res) => {
  response.success(res, "Aether API");
});

router.get("/api/version", systemController.version);

module.exports = router;