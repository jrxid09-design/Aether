class DeleteTool {

    constructor() {
        this.name = "delete";
        this.description = "HTTP DELETE request";
    }

    async execute(context, params = {}) {
        return {
            success: true,
            data: {}
        };
    }

}

module.exports = DeleteTool;