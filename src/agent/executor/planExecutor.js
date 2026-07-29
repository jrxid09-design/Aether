const AgentPhase = require("../runtime/agentPhase");
const ExecutionResult = require("./executionResult");
const Observation = require("../models/observation");

const toolRegistry = require("../../tools/registry/toolRegistry");

class PlanExecutor extends AgentPhase {

    async run(state) {

        state.execution = await this.execute(state.plan);
        state.observations = state.execution.observations;

    }

    async execute(plan) {

        const result = new ExecutionResult();

        if (!plan || !plan.steps || plan.steps.length === 0) {
            return result;
        }

        for (const step of plan.steps) {

            const tool = toolRegistry.get(step.tool);

            if (!tool) {

                result.add(new Observation({
                    tool: step.tool,
                    success: false,
                    error: "Tool not found."
                }));

                continue;
            }

            try {

                const output = await tool.execute(step.arguments);

                result.add(new Observation({
                    tool: step.tool,
                    success: true,
                    result: output
                }));

            } catch (err) {

                result.add(new Observation({
                    tool: step.tool,
                    success: false,
                    error: err.message
                }));

            }
        }

        return result;
    }
}

module.exports = PlanExecutor;