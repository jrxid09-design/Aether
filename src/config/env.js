require("dotenv").config();

module.exports = {
  port: process.env.PORT || 3000,
  appName: process.env.APP_NAME || "Aether",
  version: process.env.APP_VERSION || "0.1.0",
  environment: process.env.NODE_ENV || "development"
};