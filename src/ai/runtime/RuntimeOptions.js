class RuntimeOptions {

    constructor({

        defaultProvider = null,

        defaultModel = null,

        // Model lokal (Ollama) sering perlu waktu muat model
        // pertama kali, jadi ambangnya lebih longgar dari cloud.
        timeout = 120000,

        retry = {

            enabled: true,

            attempts: 3,

            delay: 1000

        },

        logging = {

            enabled: true

        },

        metrics = {

            enabled: true

        },

        events = {

            enabled: true

        }

    } = {}) {

        this.defaultProvider = defaultProvider;

        this.defaultModel = defaultModel;

        this.timeout = timeout;

        this.retry = {

            ...retry

        };

        this.logging = {

            ...logging

        };

        this.metrics = {

            ...metrics

        };

        this.events = {

            ...events

        };

        this.maxToolIterations = 10;


    }

}

module.exports = RuntimeOptions;