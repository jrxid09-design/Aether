class PostTool {

    constructor() {
        this.name = "post";
        this.description = "HTTP POST request";
    }

    async execute(context, params = {}) {
        return {
            success: true,
            data: {}
        };
    }

}

module.exports = PostTool;