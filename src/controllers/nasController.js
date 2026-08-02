const response = require("../utils/response");
const nasService = require("../services/nasService");
const immichDeploy = require("../services/immichDeployService");

class NasController {

    async status(req, res, next) {
        try { return response.success(res, "NAS status", await nasService.status()); }
        catch (error) { next(error); }
    }

    async config(req, res, next) {
        try {
            const c = nasService.config();
            // Jangan bocorkan password DB Immich.
            return response.success(res, "NAS config", { pool: c.pool });
        }
        catch (error) { next(error); }
    }

    async setConfig(req, res, next) {
        try { return response.success(res, "NAS config disimpan", { pool: nasService.setConfig(req.body ?? {}).pool }); }
        catch (error) { return response.error(res, error.message, 400); }
    }

    // ---- Immich (app center) -------------------------------------

    async immichStatus(req, res, next) {
        try { return response.success(res, "Immich status", await immichDeploy.status()); }
        catch (error) { next(error); }
    }

    async immichUp(req, res, next) {
        try { return response.success(res, "Immich dinyalakan", immichDeploy.up()); }
        catch (error) { return response.error(res, error.message, 400); }
    }

    async immichDown(req, res, next) {
        try { return response.success(res, "Immich dimatikan", await immichDeploy.down()); }
        catch (error) { return response.error(res, error.message, 400); }
    }

}

module.exports = new NasController();
