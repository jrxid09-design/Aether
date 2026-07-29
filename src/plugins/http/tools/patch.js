class PatchTool {

    constructor() {
        this.name = "patch";
        this.description = "HTTP PATCH request";
    }

    async execute(context, params = {}) {
        return {
            success: true,
            data: {}
        };
    }

}

module.exports = PatchTool;