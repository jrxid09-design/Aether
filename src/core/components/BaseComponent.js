const Result = require("../models/Result");
const Logger = require("../logger/Logger");
const Config = require("../config/Config");

const {
    BaseLifecycle
} = require("../lifecycle");

class BaseComponent extends BaseLifecycle {

    constructor(metadata = {}) {

        super();

        this.metadata = metadata;

    }

}

module.exports = BaseComponent;