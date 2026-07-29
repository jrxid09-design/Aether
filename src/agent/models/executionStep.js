class ExecutionStep {
  constructor({
    tool,
    arguments: args = {},
    id = null,
    metadata = {},
  }) {
    this.id = id ?? crypto.randomUUID();
    this.tool = tool;
    this.arguments = args;
    this.metadata = metadata;
  }
}

module.exports = ExecutionStep;