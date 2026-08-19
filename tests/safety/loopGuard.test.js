const test = require("node:test");
const assert = require("node:assert");

const loopGuard = require("../../src/core/safety/loopGuard");

/** Tes deteksi kebuntuan (§140). */

test.beforeEach(() => loopGuard.reset());

test("panggilan identik lolos sampai ambang, lalu dihentikan", () => {

    const args = { operation: "add", a: 1, b: 1 };

    // Ambang 4: empat pertama harus lolos.
    for (let i = 1; i <= 4; i++) {
        assert.doesNotThrow(
            () => loopGuard.assertNotLooping("calculator.calculator", args),
            `panggilan ke-${i} seharusnya masih lolos`
        );
    }

    assert.throws(
        () => loopGuard.assertNotLooping("calculator.calculator", args),
        err => err.code === "LOOP_DETECTED",
        "panggilan ke-5 identik harus dihentikan"
    );

});

test("argumen berbeda tidak dianggap kebuntuan", () => {

    // Pengulangan sah itu nyata; salah tuduh lebih merusak
    // daripada membiarkan beberapa lewat.
    for (let i = 1; i <= 10; i++) {
        assert.doesNotThrow(
            () => loopGuard.assertNotLooping("calculator.calculator", { a: i, b: 2 }),
            `argumen berbeda ke-${i} tidak boleh diblokir`
        );
    }

});

test("tool berbeda dengan argumen sama tidak saling mengunci", () => {

    const args = { path: "/tmp/x" };

    for (let i = 1; i <= 4; i++) {
        loopGuard.assertNotLooping("filesystem.readFile", args);
    }

    assert.doesNotThrow(
        () => loopGuard.assertNotLooping("filesystem.exists", args),
        "jejak satu tool tidak boleh menghakimi tool lain"
    );

});

test("reset memberi kesempatan bersih", () => {

    const args = { a: 1 };

    for (let i = 1; i <= 4; i++) {
        loopGuard.assertNotLooping("t.x", args);
    }

    loopGuard.reset();

    assert.doesNotThrow(
        () => loopGuard.assertNotLooping("t.x", args),
        "setelah reset, giliran baru harus bebas dari jejak lama"
    );

});

test("error identik berulang dihentikan", () => {

    const err = { code: "ECONNREFUSED", message: "connection refused" };

    // Ambang 5.
    for (let i = 1; i <= 5; i++) {
        assert.doesNotThrow(
            () => loopGuard.recordFailure("http.get", err),
            `kegagalan ke-${i} masih boleh dicatat`
        );
    }

    assert.throws(
        () => loopGuard.recordFailure("http.get", err),
        e => e.code === "REPEATED_FAILURE",
        "kegagalan identik ke-6 harus menghentikan"
    );

});

test("error berbeda tidak menumpuk jadi kebuntuan", () => {

    for (let i = 1; i <= 10; i++) {
        assert.doesNotThrow(
            () => loopGuard.recordFailure("http.get", { code: `ERR_${i}` })
        );
    }

});

test("setelah dihentikan, jejak dibersihkan agar strategi baru bisa jalan", () => {

    const args = { a: 1 };

    for (let i = 1; i <= 4; i++) loopGuard.assertNotLooping("t.y", args);

    assert.throws(() => loopGuard.assertNotLooping("t.y", args));

    // Blokir tidak boleh permanen — kalau model mengubah pendekatan
    // lalu kembali ke tool ini, ia berhak mencoba lagi.
    assert.doesNotThrow(
        () => loopGuard.assertNotLooping("t.y", args),
        "jejak harus bersih setelah blokir dijatuhkan"
    );

});
