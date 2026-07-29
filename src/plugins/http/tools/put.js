class PutTool {

    constructor() {
        this.name = "put";
        this.description = "HTTP PUT request";
    }

    async execute(context, params = {}) {
        return {
            success: true,
            data: {}
        };
    }

}

module.exports = PutTool;