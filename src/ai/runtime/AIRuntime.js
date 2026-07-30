const BaseComponent = require("../../core/components/BaseComponent");

const {

    AIEventEmitter

} = require("../events");

const {

    MiddlewarePipeline

} = require("../middleware");

const {
    AIToolRegistry
} = require("../tools");

const {
    AIProviderRegistry
} = require("../providers");

const {
    ProviderNotFoundError
} = require("../exceptions");

const {
    RuntimeValidator
} = require("../validators");

const {
    RuntimeLogger
} = require("../loggers");

const {
    RuntimeExecutor,
    RetryExecutor,
    TimeoutExecutor
} = require("../executors");

const {
    AIService
} = require("../services");

const RuntimeOptions = require("./RuntimeOptions");
const RuntimeMetrics = require("./RuntimeMetrics");

const {
    AIRequestStartedEvent,
    AIRequestCompletedEvent,
    AIRequestFailedEvent
} = require("../events");

class AIRuntime extends BaseComponent {

    constructor(
    context,
    options = new RuntimeOptions()
) {

    super();

    this.context = context;

    this.options = options;

    this.providerRegistry =
        new AIProviderRegistry();

    this.metrics =
        new RuntimeMetrics();

    this.validator =
        new RuntimeValidator();

    this.logger =
        new RuntimeLogger(
            context?.logger
        );

    this.service =
        new AIService();

    this.pipeline =
        new MiddlewarePipeline();

    this.eventEmitter =
        new AIEventEmitter();

    this.toolRegistry =
        new AIToolRegistry();

    this.executor =
        new RuntimeExecutor(
            this.service,
            {

                maxToolIterations:
                    this.options.maxToolIterations,

                events:
                    this.eventEmitter,

                logger:
                    this.logger

            }
        );

    this.retryExecutor =
        new RetryExecutor(this.options.retry);

    this.timeoutExecutor =
        new TimeoutExecutor(
            options.timeout
        );

    this.currentProviderId = null;

}

    useMiddleware(middleware) {

        this.pipeline.use(middleware);

        return this;

    }

    registerProvider(id, provider) {

        this.providerRegistry.register(id, provider);

        return this;

    }

    unregisterProvider(id) {

        this.providerRegistry.unregister(id);

        return this;

    }

    getProvider(id) {

        return this.providerRegistry.get(id);

    }

    hasProvider(id) {

        return this.providerRegistry.has(id);

    }

    listProviders() {

        return this.providerRegistry.list();

    }

    use(id) {

        const provider =
            this.getProvider(id);

        if (!provider) {

            throw new ProviderNotFoundError(id);

        }

        this.currentProviderId = id;

        this.service.setProvider(provider);

        return this;

    }

    setDefaultModel(model) {

        this.options.defaultModel = model;

        return this;

    }

    setToolRegistry(registry) {

    this.toolRegistry = registry;

    this.executor.setToolRegistry(registry);

    return this;

}

getToolRegistry() {

    return this.toolRegistry;

}

    async chat(request) {

        this.validator.validate(request);

        if (!request.model) {

    request.model =
        this.options.defaultModel;

}

if (request.tools === undefined) {

    request.tools =
        this.toolRegistry?.all() ?? [];

}

        this.context?.emit?.(
            new AIRequestStartedEvent({
                provider: this.currentProviderId,
                request
            })
        );

        this.logger.started(
            this.currentProviderId,
            request
        );

        const started =
            Date.now();

        try {

            const response =
                await this.timeoutExecutor.execute(
                    () => this.retryExecutor.execute(
                        () => this.executor.execute(request)
                    )
                );

            const duration =
                Date.now() - started;

            this.metrics.recordSuccess({

                duration,

                tokens:
                    response?.usage?.totalTokens ?? 0

            });

            this.logger.completed(

                this.currentProviderId,

                duration

            );

            this.context?.emit?.(
                new AIRequestCompletedEvent({

                    provider:
                        this.currentProviderId,

                    duration,

                    request,

                    response

                })
            );

            return response;

        }

        catch (error) {

            const duration =
                Date.now() - started;

            this.metrics.recordFailure({

                duration

            });

            this.logger.failed(

                this.currentProviderId,

                error

            );

            this.context?.emit?.(
                new AIRequestFailedEvent({

                    provider:
                        this.currentProviderId,

                    duration,

                    request,

                    error

                })
            );

            throw error;

        }

    }
    async *stream(request) {

    this.validator.validate(request);

    if (!request.model) {

        request.model =
            this.options.defaultModel;

    }

    if (request.tools === undefined) {

        request.tools =
            this.toolRegistry?.all() ?? [];

    }

    yield* this.executor.stream(request);

}
getEventEmitter() {

    return this.eventEmitter;

}

}

module.exports = AIRuntime;