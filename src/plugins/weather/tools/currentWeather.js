class CurrentWeatherTool extends BaseTool {

    constructor() {

        super({

            name: "currentWeather",

            description: "Current weather.",

            parameters: {

                city: {

                    type: "string",

                    required: true

                }

            }

        });

    }

    async execute(args) {

        return WeatherService.current(args.city);

    }

}