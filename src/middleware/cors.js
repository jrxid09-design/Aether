/**
 * CORS untuk Aether Console.
 *
 * Renderer Electron memuat berkas lewat file://, sehingga
 * Origin-nya "null" — tidak bisa dicocokkan dengan allowlist
 * berbasis host. Karena daemon ini memang ditujukan untuk
 * jaringan pribadi, origin diizinkan luas dan pengamanan
 * sesungguhnya diserahkan ke token (lihat middleware/auth.js).
 */
module.exports = (req, res, next) => {

    const origin = req.headers.origin;

    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");

    res.setHeader("Vary", "Origin");

    res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type,Authorization"
    );

    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

};
