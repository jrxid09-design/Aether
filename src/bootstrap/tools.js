const toolRegistry = require("../tools");

module.exports = () => {
  console.log(`Loaded ${toolRegistry.list().length} tool(s)`);
  console.table(toolRegistry.list());
};