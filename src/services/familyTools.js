const { AITool } = require("../ai/tools");

const exposure = require("./exposureService");
const familyLocation = require("./familyLocationService");

/**
 * Tool AI keluarga berbasis-izin:
 *  - family_check_exposure — cek kebocoran data akun sendiri/keluarga (HIBP).
 *  - family_locations      — lihat lokasi anggota yang OPT-IN berbagi.
 *
 * Prinsip (ditegakkan lewat deskripsi): hanya untuk akun/anggota yang
 * izinnya dipegang pengguna. Tak ada pelacakan nomor telepon, tak ada
 * data pihak ketiga. Pendaftaran anggota & kirim lokasi dilakukan lewat
 * perangkat masing-masing (REST + token), bukan dari chat.
 */
function familyTools() {

    return [

        new AITool({
            name: "family_check_exposure",
            description:
                "Cek apakah sebuah email/username muncul di kebocoran data publik (Have I Been " +
                "Pwned). Pakai HANYA untuk akun milik pengguna sendiri atau keluarga yang " +
                "izinnya dipegang pengguna — ini alat keamanan diri, bukan menyelidiki orang " +
                "lain. Hasil hanya 'akun ada di kebocoran apa saja' + saran, bukan kata sandi.",
            parameters: {
                type: "object",
                properties: {
                    account: { type: "string", description: "Email atau username yang ingin dicek." }
                },
                required: ["account"]
            },
            execute: async ({ account }) => {
                const r = await exposure.check(account);
                return {
                    account: r.account,
                    breached: r.breached,
                    count: r.count,
                    breaches: r.breaches.map(b => ({ name: b.title || b.name, when: b.breachDate, data: b.dataClasses })),
                    advice: r.advice
                };
            }
        }),

        new AITool({
            name: "family_locations",
            description:
                "Lihat lokasi terkini anggota keluarga yang SUDAH menyetujui berbagi lokasi " +
                "(opt-in). Pakai untuk menjawab 'di mana anggota keluargaku'. Hanya menampilkan " +
                "anggota yang perangkatnya aktif mengirim lokasi; tak bisa melacak nomor yang " +
                "tak ikut berbagi.",
            parameters: { type: "object", properties: {} },
            execute: async () => {
                const { members } = familyLocation.list();
                return {
                    members: members.map(m => ({
                        name: m.name,
                        sharing: m.sharing,
                        location: m.location ? { lat: m.location.lat, lng: m.location.lng } : null,
                        updatedAt: m.updatedAt
                    }))
                };
            }
        })

    ];
}

module.exports = { familyTools };
