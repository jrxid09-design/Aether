const response = require("../utils/response");
const exposureService = require("../services/exposureService");
const familyLocationService = require("../services/familyLocationService");

/**
 * Fitur keluarga berbasis-izin:
 *  - Cek Paparan Data (HIBP) — akun sendiri/keluarga yang izinnya dipegang.
 *  - Berbagi Lokasi Keluarga (opt-in) — bukan pelacakan nomor.
 */
class ExposureController {

    // ---- Cek Paparan Data ----------------------------------------

    async status(req, res, next) {
        try { return response.success(res, "Status paparan", exposureService.status()); }
        catch (error) { next(error); }
    }

    async configure(req, res, next) {
        try { return response.success(res, "API key disimpan", exposureService.configure(req.body ?? {})); }
        catch (error) { return response.error(res, error.message, 400); }
    }

    async check(req, res, next) {
        try {
            const { account } = req.body ?? {};
            if (!account) return response.error(res, "Field 'account' (email/username) wajib.", 400);
            return response.success(res, "Hasil cek paparan", await exposureService.check(account));
        }
        catch (error) { return response.error(res, error.message, 400); }
    }

    // ---- Berbagi Lokasi Keluarga ---------------------------------

    async members(req, res, next) {
        try { return response.success(res, "Anggota keluarga", familyLocationService.list()); }
        catch (error) { next(error); }
    }

    async register(req, res, next) {
        try { return response.success(res, "Anggota didaftarkan", familyLocationService.register(req.body ?? {}), 201); }
        catch (error) { return response.error(res, error.message, 400); }
    }

    async updateLocation(req, res, next) {
        try {
            const { token, ...rest } = req.body ?? {};
            return response.success(res, "Lokasi diperbarui", familyLocationService.update(token, rest));
        }
        catch (error) { return response.error(res, error.message, 400); }
    }

    async revoke(req, res, next) {
        try { return response.success(res, "Berbagi dicabut", familyLocationService.revoke(req.params.id)); }
        catch (error) { return response.error(res, error.message, 400); }
    }

}

module.exports = new ExposureController();
