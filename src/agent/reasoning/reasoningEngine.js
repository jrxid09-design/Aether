const llm = require("./llmClient");
const ReasoningContext = require("./reasoningContext");

class ReasoningEngine {

  async execute(state) {

    const context =
      new ReasoningContext(state);

    return await llm.generate(context);

  }

}

module.exports = new ReasoningEngine();