"use strict";

/**
 * ACTION VERIFICATION + COMPENSATION FABRIC V1 — TEST-ONLY VERIFICATION
 * HARNESS (mirrors the certified Lane 3 actuation harness pattern).
 *
 * Production src/action/verification/*.js export ONLY inert vocabulary + pure
 * predicates — the privileged constructors (verifier registry, formers,
 * evaluator, sanitizer, compensation dispatcher) live ONLY in the trusted
 * bootstrap's private lexical closure (src/action/bootstrap.js). Tests cannot
 * import them from production; this harness owns its OWN private copies of the
 * same implementation (the test-domain analogue of the trusted bootstrap
 * closure) and is reachable ONLY under tests/ (production src/** never
 * imports it).
 *
 * The test harness composes the canonical verification path over TEST-DOMAIN
 * canonical Lane 3 ExecutionResults — produced by tests/actuation/harness.js
 * against ITS closure-private brand. The harness's private formers brand their
 * outputs against this harness's OWN closure-private brand WeakSets, exactly
 * mirroring how the production trusted bootstrap brands against ITS
 * closure-private WeakSets. The public production brand predicates live as
 * methods on createCanonicalVerificationFacade() (which tests can also
 * exercise directly to prove hostile-input safety on the real predicates).
 *
 * The trusted test harness owns:
 *   - test verifier registry + registrar (test-owned, never reachable from src/action)
 *   - test verification request/result/plan formers (private copies)
 *   - test postcondition former/evaluator (private copies)
 *   - test evidence sanitizer (private copy)
 *   - test compensation dispatcher that routes through the actuation harness's
 *     execute() — exactly mirroring the production "compensation is a new
 *     Lane 3 action" path
 *
 * Downstream test code receives ONLY { verify, compensate } + the brand
 * predicates — exactly like production.
 */

const crypto = require("node:crypto");
const {
    VERIFICATION_STATE, COMPENSATION_STATE, LIFECYCLE, REASONS, fail
} = require("../../src/action/verification/errors");
const {
    POSTCONDITION_OPS, POSTCONDITION_KIND, POSTCONDITION_SCHEMA_VERSION,
    isValidPostconditionPath
} = require("../../src/action/verification/postcondition");
const {
    VERIFICATION_REQUEST_SCHEMA_VERSION,
    VERIFICATION_RESULT_SCHEMA_VERSION,
    COMPENSATION_PLAN_SCHEMA_VERSION,
    COMPENSATION_RESULT_SCHEMA_VERSION,
    BOUNDS,
    DEFAULT_VERIFY_TIMEOUT_MS,
    MIN_VERIFY_TIMEOUT_MS,
    MAX_VERIFY_TIMEOUT_MS,
    isValidVerifyTimeoutMs
} = require("../../src/action/verification/schema");
const { READINESS } = require("../../src/action/verification/verifierRegistry");
const { makeActuationHarness } = require("../actuation/harness");
const { canonicalScope } = require("../../src/action/intent");

// ---------------------------------------------------------------------------
// TEST-ONLY PRIVATE IMPLEMENTATION COPIES (mirror the production trusted
// bootstrap's private Lane 4 closure)
// ---------------------------------------------------------------------------

function isPlainObject(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

function deepFreeze(obj) {
    if (obj !== null && typeof obj === "object") {
        for (const key of Object.getOwnPropertyNames(obj)) deepFreeze(obj[key]);
        Object.freeze(obj);
    }
    return obj;
}

const DANGEROUS_KEYS = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));

function detach(value, state) {
    state.nodes++;
    if (state.nodes > state.maxNodes) throw fail(REASONS.BOUND_EXCEEDED, `payload exceeds node budget (${state.maxNodes})`);
    if (value === null) return null;
    const t = typeof value;
    if (t === "string" || t === "boolean") return value;
    if (t === "number") {
        if (!Number.isFinite(value)) throw fail(REASONS.MALFORMED_PAYLOAD, "numbers must be finite");
        return value;
    }
    if (t === "function") throw fail(REASONS.FUNCTION_VALUE, "function values are not permitted");
    if (t === "symbol" || t === "bigint" || t === "undefined") throw fail(REASONS.SYMBOL_VALUE, `${t} values are not permitted`);
    if (Array.isArray(value)) {
        if (state.path.has(value)) throw fail(REASONS.CYCLIC_INPUT, "cyclic structure is not permitted");
        if (value.length > BOUNDS.GLOBAL_MAX_ARRAY_LENGTH) throw fail(REASONS.BOUND_EXCEEDED, "array length exceeds global bound");
        state.path.add(value);
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) out[i] = detach(value[i], state);
        state.path.delete(value);
        return out;
    }
    if (!isPlainObject(value)) throw fail(REASONS.NON_PLAIN_OBJECT, "non-plain object is not permitted");
    if (state.path.has(value)) throw fail(REASONS.CYCLIC_INPUT, "cyclic structure is not permitted");
    state.path.add(value);
    const out = {};
    for (const key of Object.getOwnPropertyNames(value)) {
        if (DANGEROUS_KEYS.has(key)) throw fail(REASONS.DANGEROUS_KEY, `dangerous key '${key}' in payload`);
        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (desc && (desc.get || desc.set)) throw fail(REASONS.ACCESSOR_PROPERTY, `accessor property '${key}' is not permitted`);
        out[key] = detach(desc.value, state);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) throw fail(REASONS.SYMBOL_VALUE, "symbol keys are not permitted");
    state.path.delete(value);
    return out;
}

function requireString(value, field, maxChars, { optional = false, allowEmpty = false } = {}) {
    if (value === undefined || value === null) {
        if (optional) return "";
        throw fail(REASONS.MALFORMED_REQUEST, `${field} is required`);
    }
    if (typeof value !== "string") throw fail(REASONS.MALFORMED_REQUEST, `${field} must be a string, got ${typeof value}`);
    const s = value.trim();
    if (!optional && !allowEmpty && s.length === 0) throw fail(REASONS.MALFORMED_REQUEST, `${field} must not be empty`);
    if (s.length > maxChars) throw fail(REASONS.BOUND_EXCEEDED, `${field} exceeds ${maxChars} chars`);
    return s;
}

function requireSafeInteger(value, field) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw fail(REASONS.MALFORMED_REQUEST, `${field} must be a nonnegative safe integer`);
    }
    return value;
}

function formExpectedPostcondition(raw) {
    if (raw === undefined || raw === null) throw fail(REASONS.MALFORMED_REQUEST, "expectedPostcondition is required");
    if (typeof raw === "function" || typeof raw === "symbol" || typeof raw === "bigint") {
        throw fail(REASONS.EXECUTABLE_POSTCONDITION_REJECTED, "expected postcondition must be declarative; executable values are rejected");
    }
    if (!isPlainObject(raw)) throw fail(REASONS.NON_PLAIN_OBJECT, "expected postcondition must be a plain declarative object");
    // TRAP-BEARING PROXY REJECTION (mirrors the production closure).
    let expectedOwnKeys = null;
    try {
        expectedOwnKeys = Object.getOwnPropertyNames(raw).length;
    } catch {
        throw fail(REASONS.NON_PLAIN_OBJECT, "hostile postcondition object (ownKeys inspection failed)");
    }
    if (expectedOwnKeys === 0 && Object.keys(raw).length !== 0) {
        throw fail(REASONS.NON_PLAIN_OBJECT, "hostile postcondition object (inconsistent key enumeration)");
    }
    let detached;
    try {
        const state = { nodes: 0, maxNodes: BOUNDS.MAX_PARAMETERS_NODES, path: new Set() };
        detached = detach(raw, state);
    } catch (e) {
        if (e && typeof e.reasonCode === "string") throw e;
        throw fail(REASONS.NON_PLAIN_OBJECT, "hostile postcondition object rejected during detachment");
    }
    return finishExpectedPostcondition(detached);
}

function finishExpectedPostcondition(detached) {
    if (detached.schemaVersion !== undefined && detached.schemaVersion !== POSTCONDITION_SCHEMA_VERSION) {
        throw fail(REASONS.MALFORMED_REQUEST, `unsupported postcondition schemaVersion ${JSON.stringify(detached.schemaVersion)}`);
    }
    if (detached.kind !== undefined && detached.kind !== POSTCONDITION_KIND) {
        throw fail(REASONS.MALFORMED_REQUEST, `unsupported postcondition kind ${JSON.stringify(detached.kind)}`);
    }
    const expect = {};
    let expectCount = 0;
    if (detached.expect !== undefined && detached.expect !== null) {
        if (!isPlainObject(detached.expect)) throw fail(REASONS.MALFORMED_REQUEST, "postcondition expect must be a plain object");
        for (const [path, rule] of Object.entries(detached.expect)) {
            expectCount++;
            if (expectCount > BOUNDS.MAX_EXPECT_ENTRIES) throw fail(REASONS.BOUND_EXCEEDED, `postcondition expect exceeds ${BOUNDS.MAX_EXPECT_ENTRIES} entries`);
            if (!isValidPostconditionPath(path)) throw fail(REASONS.DANGEROUS_KEY, `invalid postcondition path '${String(path).slice(0, 64)}'`);
            if (!isPlainObject(rule)) throw fail(REASONS.MALFORMED_REQUEST, `postcondition rule for '${path}' must be a declarative object`);
            const op = rule.op;
            if (!Object.values(POSTCONDITION_OPS).includes(op)) throw fail(REASONS.MALFORMED_REQUEST, `postcondition rule for '${path}' has invalid op`);
            const ruleOut = { op };
            if ("value" in rule) {
                const valueState = { nodes: 0, maxNodes: BOUNDS.MAX_VALUE_NODES, path: new Set() };
                ruleOut.value = detach(rule.value, valueState);
            }
            expect[path] = Object.freeze(ruleOut);
        }
    }
    const forbid = {};
    let forbidCount = 0;
    if (detached.forbid !== undefined && detached.forbid !== null) {
        if (!isPlainObject(detached.forbid)) throw fail(REASONS.MALFORMED_REQUEST, "postcondition forbid must be a plain object");
        for (const [path, value] of Object.entries(detached.forbid)) {
            forbidCount++;
            if (forbidCount > BOUNDS.MAX_EXPECT_ENTRIES) throw fail(REASONS.BOUND_EXCEEDED, `postcondition forbid exceeds ${BOUNDS.MAX_EXPECT_ENTRIES} entries`);
            if (!isValidPostconditionPath(path)) throw fail(REASONS.DANGEROUS_KEY, `invalid postcondition forbid path '${String(path).slice(0, 64)}'`);
            const valueState = { nodes: 0, maxNodes: BOUNDS.MAX_VALUE_NODES, path: new Set() };
            forbid[path] = detach(value, valueState);
        }
    }
    if (expectCount === 0 && forbidCount === 0) {
        throw fail(REASONS.MALFORMED_REQUEST, "expected postcondition must contain at least one expect or forbid rule (vacuous postconditions are rejected)");
    }
    return deepFreeze({ schemaVersion: POSTCONDITION_SCHEMA_VERSION, kind: POSTCONDITION_KIND, expect: deepFreeze(expect), forbid: deepFreeze(forbid) });
}

function readPath(obj, path) {
    const segments = String(path).split(".");
    let cur = obj;
    for (const seg of segments) {
        if (cur === null || cur === undefined) return { found: false, value: undefined };
        if (typeof cur !== "object") return { found: false, value: undefined };
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) return { found: false, value: undefined };
        cur = cur[seg];
    }
    return { found: true, value: cur };
}

function evaluatePostcondition(postcondition, evidence) {
    if (!postcondition || typeof postcondition !== "object") return "insufficient";
    const ev = (evidence === null || evidence === undefined || typeof evidence !== "object") ? {} : evidence;
    let sawAny = false;
    for (const [path, rule] of Object.entries(postcondition.expect ?? {})) {
        sawAny = true;
        const { found, value } = readPath(ev, path);
        const op = rule.op;
        if (op === POSTCONDITION_OPS.EXISTS) {
            if (!found) return "insufficient";
            if (value === null || value === undefined) return "mismatched";
            continue;
        }
        if (op === POSTCONDITION_OPS.ABSENT) {
            if (found && value !== null && value !== undefined) return "mismatched";
            continue;
        }
        if (op === POSTCONDITION_OPS.IN) {
            if (!found) return "insufficient";
            const options = Array.isArray(rule.value) ? rule.value : [];
            if (!options.some((o) => o === value)) return "mismatched";
            continue;
        }
        if (op === POSTCONDITION_OPS.TYPE) {
            if (!found) return "insufficient";
            const t = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
            if (t !== rule.value) return "mismatched";
            continue;
        }
        if (!found) return "insufficient";
        if (op === POSTCONDITION_OPS.EQ) { if (value !== rule.value) return "mismatched"; }
        else if (op === POSTCONDITION_OPS.NE) { if (value === rule.value) return "mismatched"; }
        else if (op === POSTCONDITION_OPS.GT || op === POSTCONDITION_OPS.GTE || op === POSTCONDITION_OPS.LT || op === POSTCONDITION_OPS.LTE) {
            if (typeof value !== "number" || typeof rule.value !== "number") return "mismatched";
            if (op === POSTCONDITION_OPS.GT && !(value > rule.value)) return "mismatched";
            if (op === POSTCONDITION_OPS.GTE && !(value >= rule.value)) return "mismatched";
            if (op === POSTCONDITION_OPS.LT && !(value < rule.value)) return "mismatched";
            if (op === POSTCONDITION_OPS.LTE && !(value <= rule.value)) return "mismatched";
        } else return "insufficient";
    }
    for (const [path, forbiddenValue] of Object.entries(postcondition.forbid ?? {})) {
        sawAny = true;
        const { found, value } = readPath(ev, path);
        // forbid: { path: X } — the path, if present, must not equal X.
        // (To require a path be entirely absent, use
        // expect: { path: { op: "absent" } }.)
        if (found && value === forbiddenValue) return "mismatched";
    }
    if (!sawAny) return "insufficient";
    return "matched";
}

const V_EV_STRING_CHARS = 1024, V_EV_KEYS = 64, V_EV_DEPTH = 8, V_EV_NODES = 512;

function sanitizeEvidence(value) {
    const state = { nodes: 0, path: new Set() };
    function walk(v, depth) {
        state.nodes++;
        if (state.nodes > V_EV_NODES || depth > V_EV_DEPTH) return null;
        if (v === null) return null;
        const t = typeof v;
        if (t === "string") return v.length > V_EV_STRING_CHARS ? v.slice(0, V_EV_STRING_CHARS) : v;
        if (t === "boolean") return v;
        if (t === "number") return Number.isFinite(v) ? v : null;
        if (t === "bigint" || t === "symbol" || t === "undefined" || t === "function") return null;
        if (v instanceof Error) return { name: String(v.name ?? "Error").slice(0, 64), message: String(v.message ?? "").slice(0, V_EV_STRING_CHARS) };
        if (!isPlainObject(v) && !Array.isArray(v)) return null;
        if (state.path.has(v)) return null;
        state.path.add(v);
        if (Array.isArray(v)) {
            const out = v.slice(0, 256).map((x) => walk(x, depth + 1));
            state.path.delete(v);
            return out;
        }
        const out = {};
        let keys = 0;
        for (const key of Object.getOwnPropertyNames(v)) {
            if (keys >= V_EV_KEYS) break;
            keys++;
            if (DANGEROUS_KEYS.has(key)) continue;
            const desc = Object.getOwnPropertyDescriptor(v, key);
            if (!desc || desc.get || desc.set) continue;
            const kk = key.length > 128 ? key.slice(0, 128) : key;
            out[kk] = walk(desc.value, depth + 1);
        }
        state.path.delete(v);
        return out;
    }
    return walk(value, 0);
}

function buildVerifierRegistry() {
    const byId = new Map();
    const byCap = new Map();
    function canonicalOp(op) { return String(op ?? "").trim().toLowerCase(); }
    function register({ capabilityId, operations, capabilityIncarnationId, verifierId, observe, readiness = "READY" }) {
        if (typeof capabilityId !== "string" || capabilityId.length === 0) throw fail(REASONS.REGISTRATION_REJECTED, "verifier registration requires a non-empty capabilityId");
        if (!Array.isArray(operations) || operations.length === 0) throw fail(REASONS.REGISTRATION_REJECTED, "verifier registration requires a non-empty operations array");
        const ops = operations.map(canonicalOp).filter((s) => s.length > 0);
        if (ops.length === 0) throw fail(REASONS.REGISTRATION_REJECTED, "verifier registration requires a non-empty operations array");
        if (typeof capabilityIncarnationId !== "string" || capabilityIncarnationId.length === 0) throw fail(REASONS.REGISTRATION_REJECTED, "verifier registration requires a capabilityIncarnationId");
        if (typeof observe !== "function") throw fail(REASONS.REGISTRATION_REJECTED, "verifier registration requires an observe function");
        if (!READINESS[readiness]) throw fail(REASONS.REGISTRATION_REJECTED, `invalid readiness '${readiness}'`);
        const id = (typeof verifierId === "string" && verifierId.length > 0) ? verifierId : `ver-${crypto.randomUUID()}`;
        const verifierIncarnationId = `vinc-${crypto.randomUUID()}`;
        if (byId.has(id)) throw fail(REASONS.REGISTRATION_REJECTED, `verifier '${id}' is already registered; remove it first`);
        const observeFn = observe.bind({});
        const binding = Object.freeze({ capabilityId, operations: Object.freeze(ops.slice()), capabilityIncarnationId, verifierId: id, verifierIncarnationId, readiness, observe: observeFn });
        byId.set(id, binding);
        let opMap = byCap.get(capabilityId);
        if (!opMap) { opMap = new Map(); byCap.set(capabilityId, opMap); }
        for (const op of ops) {
            if (opMap.has(op)) { byId.delete(id); throw fail(REASONS.REGISTRATION_REJECTED, `verifier already registered for '${capabilityId}.${op}'`); }
            opMap.set(op, binding);
        }
        return binding;
    }
    function remove(verifierId) {
        const binding = byId.get(verifierId);
        if (!binding) return false;
        byId.delete(verifierId);
        const opMap = byCap.get(binding.capabilityId);
        if (opMap) {
            for (const op of binding.operations) {
                const cur = opMap.get(op);
                if (cur && cur.verifierId === verifierId) opMap.delete(op);
            }
            if (opMap.size === 0) byCap.delete(binding.capabilityId);
        }
        return true;
    }
    function resolve(capabilityId, operation) {
        const opMap = byCap.get(capabilityId);
        if (!opMap) return null;
        return opMap.get(canonicalOp(operation)) ?? null;
    }
    function get(verifierId) { return byId.get(verifierId) ?? null; }
    return Object.freeze({ register, remove, resolve, get });
}

// ---- TEST-DOMAIN brand WeakSets (mirror production closure-private brands) ----
const testRequestBrandSet = new WeakSet();
const testResultBrandSet = new WeakSet();
const testPlanBrandSet = new WeakSet();

const CALLER_VERIFIER_KEYS = Object.freeze([
    "verifier", "verifierFn", "observe", "observeFn", "sensor", "sensorFn",
    "predicate", "predicateFn", "evaluator", "evaluatorFn", "checker",
    "checkFn", "postconditionFn", "verifyFn"
]);
const CALLER_COMPENSATOR_KEYS = Object.freeze([
    "compensator", "compensatorFn", "rollback", "rollbackFn", "repair",
    "repairFn", "undo", "undoFn", "restore", "restoreFn", "compensateFn"
]);
const TIMEOUT_SENTINEL = Symbol("damar.action.verification.timeout");

/**
 * Build a Lane 4 test harness:
 *   {
 *     lane3,                // Lane 3 actuation harness (execute + brand predicates)
 *     verify, compensate,
 *     isCanonicalVerificationRequest,
 *     isCanonicalVerificationResult,
 *     isCanonicalCompensationPlan,
 *     registerVerifier, removeVerifier
 *   }
 */
async function makeVerificationHarness({ clock, scopeBindings, authenticate } = {}) {
    const lane3 = await makeActuationHarness({ clock, scopeBindings, authenticate });
    const verifierRegistry = buildVerifierRegistry();
    // Local actuation brand set of the Lane 3 harness this verification
    // harness composes over. Verification is bound to the canonical Lane 3
    // brand — results from a DIFFERENT harness (different trust domain)
    // are rejected by the brand check below.
    const lane3ResultBrand = lane3._localResultBrandSet;

    const verificationsById = new Map();
    const compensationById = new Map();

    function canonicalClockNow() {
        const v = (clock ? clock.nowMs() : Date.now());
        if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
            throw fail(REASONS.MALFORMED_REQUEST, "canonical clock returned an invalid timestamp");
        }
        return v;
    }

    async function verify(p) {
        if (p === null || typeof p !== "object") throw fail(REASONS.MALFORMED_REQUEST, "verify requires a request object");
        for (const key of CALLER_VERIFIER_KEYS) {
            if (Object.prototype.hasOwnProperty.call(p, key) && p[key] !== undefined) {
                throw fail(REASONS.CALLER_VERIFIER_REJECTED, `caller-verifier option '${key}' is forbidden; the verifier is bootstrap-owned, never caller-selectable`);
            }
        }
        for (const key of CALLER_COMPENSATOR_KEYS) {
            if (Object.prototype.hasOwnProperty.call(p, key) && p[key] !== undefined) {
                throw fail(REASONS.CALLER_EXECUTOR_REJECTED, `caller-compensator option '${key}' is forbidden; compensation is a canonical action routed through Lane 3`);
            }
        }
        const executionResult = p.executionResult;
        // TEST-DOMAIN canonical brand check (mirrors the production brand check).
        if (!lane3ResultBrand.has(executionResult)) {
            throw fail(REASONS.NOT_CANONICAL_EXECUTION_RESULT,
                "verification requires a canonical Lane 3 ExecutionResult; arbitrary result-shaped objects, JSON clones, and foreign-domain results are not verifiable");
        }
        if (typeof executionResult.executionId !== "string" || !executionResult.executionId ||
            (executionResult.state !== undefined && !["EXECUTED", "FAILED", "TIMED_OUT", "CANCELLED"].includes(executionResult.state))) {
            throw fail(REASONS.FOREIGN_DOMAIN_RESULT, "execution result carries a foreign/non-canonical shape");
        }
        const expectedPostcondition = formExpectedPostcondition(p.expectedPostcondition);
        const timeoutMs = (p.timeoutMs === undefined) ? DEFAULT_VERIFY_TIMEOUT_MS
            : (isValidVerifyTimeoutMs(p.timeoutMs) ? p.timeoutMs
                : (() => { throw fail(REASONS.INVALID_TIMEOUT_CONFIG, `verify timeoutMs must be in [${MIN_VERIFY_TIMEOUT_MS}, ${MAX_VERIFY_TIMEOUT_MS}]`); })());

        const binding = verifierRegistry.resolve(executionResult.capabilityId, executionResult.operation);
        if (!binding) throw fail(REASONS.VERIFIER_NOT_FOUND, `no verifier registered for '${executionResult.capabilityId}.${executionResult.operation}'`);
        if (binding.capabilityIncarnationId !== executionResult.capabilityIncarnationId) {
            throw fail(REASONS.VERIFIER_INCARNATION_MISMATCH, `verifier binding capability incarnation ${binding.capabilityIncarnationId} != result ${executionResult.capabilityIncarnationId}`);
        }
        if (binding.readiness !== READINESS.READY) throw fail(REASONS.VERIFIER_UNAVAILABLE, `verifier readiness is ${binding.readiness}`);

        const verificationId = crypto.randomUUID();
        if (verificationsById.has(verificationId)) throw fail(REASONS.DUPLICATE_VERIFICATION_ID, "duplicate verificationId");

        const requestedAtMs = canonicalClockNow();
        const request = deepFreeze({
            schemaVersion: VERIFICATION_REQUEST_SCHEMA_VERSION,
            verificationId,
            executionId: executionResult.executionId,
            intentId: executionResult.intentId,
            capabilityId: executionResult.capabilityId,
            capabilityIncarnationId: executionResult.capabilityIncarnationId,
            operation: executionResult.operation,
            principal: executionResult.principal,
            scope: deepFreeze(Array.isArray(executionResult.scope) ? executionResult.scope.slice() : []),
            actuatorId: executionResult.actuatorId,
            actuatorIncarnationId: executionResult.actuatorIncarnationId,
            authorityGeneration: executionResult.authorityGeneration,
            verifierId: binding.verifierId,
            verifierIncarnationId: binding.verifierIncarnationId,
            expectedPostcondition,
            requestedAtMs,
            timeoutMs
        });
        testRequestBrandSet.add(request);

        const dupKey = crypto.createHash("sha256").update(JSON.stringify({
            e: request.executionId, v: request.verifierIncarnationId, p: request.expectedPostcondition
        })).digest("hex");
        const existing = verificationsById.get(dupKey);
        if (existing) return existing.result;

        const rec = { request, result: null };
        verificationsById.set(dupKey, rec);
        verificationsById.set(verificationId, rec);

        const observedAtMs = canonicalClockNow();
        let observation = null, verifierErrored = null;
        try {
            observation = await Promise.race([
                binding.observe({
                    verificationId: request.verificationId,
                    executionId: request.executionId,
                    intentId: request.intentId,
                    capabilityId: request.capabilityId,
                    operation: request.operation,
                    principal: request.principal,
                    scope: request.scope,
                    parameters: executionResult.parameters ?? null,
                    expectedPostcondition: request.expectedPostcondition
                }),
                new Promise((resolve) => {
                    const h = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
                    if (typeof h.unref === "function") h.unref();
                })
            ]);
        } catch (e) { verifierErrored = e; }

        let verificationState, observedEvidence = null, detail = "";
        if (verifierErrored !== null) {
            verificationState = VERIFICATION_STATE.ERROR;
            observedEvidence = sanitizeEvidence(verifierErrored);
            detail = "verifier infrastructure error";
        } else if (observation === TIMEOUT_SENTINEL) {
            verificationState = VERIFICATION_STATE.TIMED_OUT;
            detail = `verification exceeded ${timeoutMs}ms; ambiguity preserved`;
        } else {
            const evidence = sanitizeEvidence(observation);
            if (evidence === null && observation !== null && observation !== undefined) {
                verificationState = VERIFICATION_STATE.INCONCLUSIVE;
                detail = "observation could not be normalized into evidence";
            } else {
                observedEvidence = evidence;
                const verdict = evaluatePostcondition(request.expectedPostcondition, evidence);
                if (verdict === "matched") verificationState = VERIFICATION_STATE.VERIFIED_SUCCESS;
                else if (verdict === "mismatched") verificationState = VERIFICATION_STATE.VERIFIED_FAILURE;
                else { verificationState = VERIFICATION_STATE.INCONCLUSIVE; detail = "evidence missing or ambiguous for expected postcondition"; }
            }
        }

        const result = deepFreeze({
            schemaVersion: VERIFICATION_RESULT_SCHEMA_VERSION,
            verificationId: request.verificationId,
            executionId: request.executionId,
            intentId: request.intentId,
            capabilityId: request.capabilityId,
            capabilityIncarnationId: request.capabilityIncarnationId,
            operation: request.operation,
            principal: request.principal,
            actuatorId: request.actuatorId,
            actuatorIncarnationId: request.actuatorIncarnationId,
            authorityGeneration: request.authorityGeneration,
            verifierId: request.verifierId,
            verifierIncarnationId: request.verifierIncarnationId,
            expectedPostcondition: request.expectedPostcondition,
            observedEvidence: deepFreeze(observedEvidence),
            observationMethod: request.verifierId,
            verificationState,
            observedAtMs,
            verifiedAtMs: canonicalClockNow(),
            detail
        });
        testResultBrandSet.add(result);
        rec.result = result;
        return result;
    }

    async function compensate(p) {
        if (p === null || typeof p !== "object") throw fail(REASONS.MALFORMED_REQUEST, "compensate requires a request object");
        for (const key of CALLER_VERIFIER_KEYS) {
            if (Object.prototype.hasOwnProperty.call(p, key) && p[key] !== undefined) {
                throw fail(REASONS.CALLER_VERIFIER_REJECTED, `caller-verifier option '${key}' is forbidden`);
            }
        }
        for (const key of CALLER_COMPENSATOR_KEYS) {
            if (Object.prototype.hasOwnProperty.call(p, key) && p[key] !== undefined) {
                throw fail(REASONS.CALLER_EXECUTOR_REJECTED, `caller-compensator option '${key}' is forbidden; compensation routes through the canonical Lane 3 facade`);
            }
        }
        const source = p.verification;
        if (!testResultBrandSet.has(source) || source === null || typeof source !== "object") {
            throw fail(REASONS.NOT_CANONICAL_EXECUTION_RESULT, "compensation requires a canonical VerificationResult produced by this runtime");
        }        if (source.verificationState !== VERIFICATION_STATE.VERIFIED_FAILURE) {
            throw fail(REASONS.COMPENSATION_NOT_INDICATED, `verification state '${source.verificationState}' does not indicate compensation; only VERIFIED_FAILURE does`);
        }

        const planCapabilityId = requireString(p.capabilityId, "capabilityId", BOUNDS.MAX_CAPABILITY_ID_CHARS);
        const planOperation = requireString(p.operation, "operation", BOUNDS.MAX_OPERATION_CHARS);
        const planPrincipal = requireString(p.principal, "principal", BOUNDS.MAX_PRINCIPAL_CHARS);
        const planScope = canonicalScope(Array.isArray(p.scope) ? p.scope : []);
        const paramsState = { nodes: 0, maxNodes: BOUNDS.MAX_PARAMETERS_NODES, path: new Set() };
        const planParameters = (p.parameters === undefined || p.parameters === null) ? deepFreeze({}) : deepFreeze(detach(p.parameters, paramsState));
        if (Object.getOwnPropertyNames(planParameters).length > BOUNDS.MAX_COMPENSATION_PARAMETERS_KEYS) {
            throw fail(REASONS.BOUND_EXCEEDED, `compensation parameters exceed ${BOUNDS.MAX_COMPENSATION_PARAMETERS_KEYS} keys`);
        }
        const reason = requireString(p.reason, "reason", BOUNDS.MAX_COMPENSATION_REASON_CHARS);

        const compensationId = (p.compensationId === undefined || p.compensationId === null)
            ? crypto.randomUUID() : requireString(p.compensationId, "compensationId", BOUNDS.MAX_VERIFICATION_ID_CHARS);
        const existingRecord = compensationById.get(compensationId);
        if (existingRecord) return existingRecord.result;

        const createdAtMs = canonicalClockNow();
        const plan = deepFreeze({
            schemaVersion: COMPENSATION_PLAN_SCHEMA_VERSION,
            compensationId,
            sourceVerificationId: source.verificationId,
            sourceExecutionId: source.executionId,
            principal: planPrincipal,
            capabilityId: planCapabilityId,
            capabilityIncarnationId: null,
            operation: planOperation,
            scope: planScope,
            parameters: planParameters,
            reason,
            createdAtMs
        });
        testPlanBrandSet.add(plan);

        const record = { plan, result: null };
        compensationById.set(compensationId, record);

        // COMPENSATION IS A NEW ACTION — route through Lane 3 canonical
        // execute(), which re-validates Lane 2 authority fresh.
        let intent;
        try {
            intent = lane3.lane2.admit(JSON.stringify({
                schemaVersion: 1,
                capabilityId: planCapabilityId,
                operation: planOperation,
                arguments: planParameters
            }), { source: "lane4-compensation" });
        } catch (e) {
            const result = deepFreeze({
                schemaVersion: COMPENSATION_RESULT_SCHEMA_VERSION, compensationId,
                sourceVerificationId: plan.sourceVerificationId, sourceExecutionId: plan.sourceExecutionId,
                state: COMPENSATION_STATE.FAILED, executionResult: null,
                detail: `compensation intent rejected at admission: ${String(e?.reasonCode ?? e?.message ?? "error").slice(0, 256)}`,
                restored: null
            });
            record.result = result;
            return result;
        }

        const session = lane3.lane2.session(planPrincipal);
        let executionResult = null;
        try {
            executionResult = await lane3.execute({ intent, authSession: session, parameters: planParameters });
        } catch (e) {
            const result = deepFreeze({
                schemaVersion: COMPENSATION_RESULT_SCHEMA_VERSION, compensationId,
                sourceVerificationId: plan.sourceVerificationId, sourceExecutionId: plan.sourceExecutionId,
                state: COMPENSATION_STATE.FAILED, executionResult: null,
                detail: `compensation dispatch failed: ${String(e?.reasonCode ?? e?.message ?? "error").slice(0, 256)}`,
                restored: null
            });
            record.result = result;
            return result;
        }

        const executedOk = executionResult && executionResult.state === "EXECUTED";
        const result = deepFreeze({
            schemaVersion: COMPENSATION_RESULT_SCHEMA_VERSION, compensationId,
            sourceVerificationId: plan.sourceVerificationId, sourceExecutionId: plan.sourceExecutionId,
            state: executedOk ? COMPENSATION_STATE.EXECUTED : COMPENSATION_STATE.FAILED,
            executionResult,
            detail: executedOk
                ? "compensation action executed through canonical Lane 3; restoration NOT claimed until a fresh verification succeeds"
                : "compensation action did not execute",
            restored: null
        });
        record.result = result;
        return result;
    }

    return {
        lane3,
        verify,
        compensate,
        isCanonicalVerificationRequest(value) {
            if (value === null || typeof value !== "object") return false;
            return testRequestBrandSet.has(value);
        },
        isCanonicalVerificationResult(value) {
            if (value === null || typeof value !== "object") return false;
            return testResultBrandSet.has(value);
        },
        isCanonicalCompensationPlan(value) {
            if (value === null || typeof value !== "object") return false;
            return testPlanBrandSet.has(value);
        },
        registerVerifier: verifierRegistry.register,
        removeVerifier: verifierRegistry.remove
    };
}

module.exports = { makeVerificationHarness };
