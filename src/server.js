require("./events/listeners/loggerListener");

const app = require("./app");
const config = require("./config/env");
const logger = require("./utils/logger");

const startup = require("./bootstrap/startup");

app.listen(config.port, () => {

    startup(config);

    logger.info("SQLite connected");
    logger.info(`Server listening on http://localhost:${config.port}`);

});