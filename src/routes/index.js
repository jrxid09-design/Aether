const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    name: "Aether",
    version: "0.1.0",
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
    version: "0.1.0"
  });
});

module.exports = router;