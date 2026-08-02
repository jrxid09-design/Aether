const response = require("../utils/response");
const nasService = require("../services/nasService");

class NasController {
    async status(req, res, next) {
        try { return response.success(res, "NAS status", await nasService.status()); }
        catch (error) { next(error); }
    }
}

module.exports = new NasController();
