const BaseAgent = require("../baseAgent");
const aiProvider = require("../../providers/aiProvider");
const toolExecutor = require("../../tools/executor/toolExecutor");

class AetherAgent extends BaseAgent {
  async run(context) {
  console.log("[AetherAgent] Running");
  console.log("[AetherAgent] Message:", context.message);

  const history = [...context.history];

  if (/jam|waktu|time/i.test(context.message)) {
    console.log("[AetherAgent] Calling TimeTool");

    const result = await toolExecutor.execute(
      "getCurrentTime",
      context
    );

    console.log("[AetherAgent] Tool Result:", result);

    history.push({
      role: "system",
      content: `The current server time is ${result.locale}. Use this value as the authoritative current time.`
    });
  }

  console.log("[AetherAgent] History:");
  console.dir(history, { depth: null });

  return aiProvider.chat({
    systemPrompt: context.systemPrompt,
    history
  });
}

  async health() {
    return {
      provider: "aether",
      status: "ready"
    };
  }

  async listTools() {
    return [
      {
        name: "getCurrentTime",
        description: "Returns the current server time."
      }
    ];
  }
}

module.exports = new AetherAgent();