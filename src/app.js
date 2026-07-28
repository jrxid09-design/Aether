const express = require("express");

const routes = require("./routes");

const app = express();

app.use(express.json());

app.use("/", routes);
const response = require("./utils/response");

app.use((req, res) => {
  response.error(res, "Route not found", 404);
});

module.exports = app;