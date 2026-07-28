const express = require("express");

const routes = require("./routes");

const app = express();

const errorHandler = require("./errors/errorHandler");

app.use(express.json());

app.use("/", routes);
const response = require("./utils/response");

app.use((req, res) => {
  response.error(res, "Route not found", 404);
});
app.use(errorHandler);

module.exports = app;