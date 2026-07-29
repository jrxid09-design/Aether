require("./events/listeners/loggerListener");

const app = require("./app");
const config = require("./config/env");
const logger = require("./utils/logger");

app.listen(config.port, () => {
  logger.info(
    `${config.appName} v${config.version} is running on http://localhost:${config.port}`
  );

  logger.info(`Environment: ${config.environment}`);
});