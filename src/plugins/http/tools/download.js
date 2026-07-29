class DownloadTool {

    constructor() {
        this.name = "download";
        this.description = "Download file";
    }

    async execute(context, params = {}) {
        return {
            success: true,
            data: {}
        };
    }

}

module.exports = DownloadTool;