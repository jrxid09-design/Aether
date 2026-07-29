class CurrentWeatherTool {

    constructor() {
        this.name = "currentWeather";
        this.description = "Get current weather";
    }

    async execute(context, params = {}) {

        return {
            success: true,
            data: {
                city: params.city || "Unknown",
                temperature: 30,
                condition: "Sunny"
            }
        };

    }

}

module.exports = CurrentWeatherTool;