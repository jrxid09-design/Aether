"use strict";

/**
 * ACTION ACTUATION FABRIC V1 — TRUSTED TEST ACTUATION HARNESS (Lane 3).
 *
 * TEST-ONLY composition harness mirroring the production bootstrap's private
 * actuation closure. Lives under tests/ and is NOT reachable from src/action
 * production exports. It owns:
 *   - a Lane 2 test harness (from tests/action/bootstrapHarness.js)
 *   - the actuator registry + registrar capability (test-owned)
 *   - the canonical dispatcher (with the test Lane 2 facade for revalidation)
 *
 * Downstream (in tests = channel/model code analogues) receives ONLY
 * { execute } — exactly like production. Registration happens through the
 * harness's own registrar surface, mirroring how the trusted runtime layer
 * would wire real actuators in a later lane.
 */

const { composeDispatcher } = require("../../src/action/actuation/dispatcher");
const { buildActuatorRegistry } = require("../../src/action/actuation/actuatorRegistry");
const { makeHarness } = require("../action/bootstrapHarness");

/**
 * Build a Lane 3 test harness:
 *   {
 *     lane2,                 // Lane 2 test harness (registry, store, session, admit, evaluate, ...)
 *     execute,               // the ONLY downstream-received capability
 *     registerActuator,      // test-registrar capability (mirrors trusted wiring)
 *     removeActuator,
 *     dispatcherState
 *   }
 */
async function makeActuationHarness({ clock, scopeBindings, authenticate } = {}) {
    const lane2 = await makeHarness({ clock, scopeBindings, authenticate });
    const actuatorRegistry = buildActuatorRegistry();
    const dispatcher = composeDispatcher({
        lane2Facade: {
            admit: lane2.admit,
            evaluate: lane2.evaluate,
            authenticate: lane2.authDomain.authenticate,
            session: lane2.session
        },
        actuatorRegistry,
        clock: { nowMs: () => lane2.clock.nowMs() }
    });
    return {
        lane2,
        execute: dispatcher.execute,
        registerActuator: actuatorRegistry.register,
        removeActuator: actuatorRegistry.remove,
        dispatcherState: dispatcher.dispatcherState
    };
}

module.exports = { makeActuationHarness };
