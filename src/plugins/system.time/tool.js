class TimeTool {

    constructor() {
        this.name = "currentTime";
        this.description = "Get the current system time.";
    }

    async execute(context, args) {

        return {
            time: new Date().toISOString()
        };

    }

}

module.exports = TimeTool;