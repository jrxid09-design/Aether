const ExecutionStep = require("./executionStep");

class ExecutionPlan {
  constructor({
    thought = "",
    steps = [],
  } = {}) {
    this.thought = thought;
    this.steps = steps.map(step =>
      step instanceof ExecutionStep
        ? step
        : new ExecutionStep(step)
    );
  }

  addStep(step) {
    this.steps.push(
      step instanceof ExecutionStep
        ? step
        : new ExecutionStep(step)
    );
  }

  get hasSteps() {
    return this.steps.length > 0;
  }
}

module.exports = ExecutionPlan;