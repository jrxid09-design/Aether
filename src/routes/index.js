const express = require("express");
const config = require("../config/env");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    name: config.appName,
    version: config.version,
    environment: config.environment,
    status: "online"
  });
});

router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime()
  });
});

router.get("/api", (req, res) => {
  res.json({
    message: "Aether API"
  });
});

router.get("/api/version", (req, res) => {
  res.json({
    version: config.version
  });
});

module.exports = router;