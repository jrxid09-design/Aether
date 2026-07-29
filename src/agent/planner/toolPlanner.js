const AgentPhase = require("../runtime/agentPhase");
const ExecutionPlan = require("../models/executionPlan");

class ToolPlanner extends AgentPhase {

    async run(state) {
        state.plan = await this.plan(state.context);
    }

    async plan(context) {

        const message = context.message.toLowerCase();

        const plan = new ExecutionPlan({
            thought: "Planning execution."
        });

        if (
            message.includes("jam") ||
            message.includes("waktu")
        ) {
            plan.addStep({
                tool: "getCurrentTime",
                arguments: {}
            });
        }

        return plan;
    }
}

module.exports = ToolPlanner;