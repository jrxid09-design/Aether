class HeadTool {

    constructor() {
        this.name = "head";
        this.description = "HTTP HEAD request";
    }

    async execute(context, params = {}) {
        return {
            success: true,
            data: {}
        };
    }

}

module.exports = HeadTool;