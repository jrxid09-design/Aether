const test = require("node:test");
const assert = require("node:assert");

const {
    DesktopContextCore,
    ContextSnapshot,
    ContextReferenceResolver,
    ENTITY_TYPE,
    DESKTOP_EVENT,
    TRANSITION
} = require("../../src/desktop");
const { FakeDesktopAdapter } = require("../../src/desktop/adapters/FakeDesktopAdapter");
const { WindowsActiveWindowAdapter } = require("../../src/desktop/adapters/WindowsActiveWindowAdapter");

/**
 * SUITE SEMANTIC DESKTOP CORE — keadaan kanonik, event model,
 * riwayat berbatas, invalidasi, dan lifecycle adapter.
 */

function harness({ clockValue = 1000, maxHistory } = {}) {
    const clock = () => clockValue;
    const core = new DesktopContextCore({ clock, maxHistory });
    core.registerAdapter({
        adapterId: "fake-desktop",
        trusted: true,
        capabilities: ["test"]
    });
    const adapter = new FakeDesktopAdapter({ emit: (o) => core.ingest(o), clock });
    adapter.start();
    return { core, adapter, clock };
}

// ---- 1-2. aktivasi aplikasi & jendela ---------------------------------

test("aktivasi aplikasi dan jendela menjadi pointer aktif", () => {
    const { core, adapter } = harness();
    adapter.activateApplication({ id: "app-notepad", label: "Notepad" });
    adapter.activateWindow({
        windowId: "win-main",
        appId: "app-notepad",
        label: "catatan.txt - Notepad"
    });

    const app = core.getActiveApplication();
    const win = core.getActiveWindow();

    assert.equal(app.id, "app-notepad");
    assert.equal(app.type, ENTITY_TYPE.APPLICATION);
    assert.equal(win.id, "win-main");
    // Jendela aktif menyiratkan aplikasi induknya aktif (relasi active_in).
    assert.equal(core.getActiveApplication().id, "app-notepad");
});

// ---- 3. konteks dokumen ------------------------------------------------

test("jendela dengan dokumen menjadikan dokumen itu aktif; dokumen baru menimpa", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({
        windowId: "win-main",
        appId: "app-notepad",
        documentId: "doc-catatan",
        documentPath: "/home/user/catatan.txt"
    });

    assert.equal(core.getActiveDocument()?.id, "doc-catatan");
    assert.equal(core.getActiveDocument()?.attributes.path, "/home/user/catatan.txt");

    adapter.openDocument({ documentId: "doc-lain", path: "/tmp/lain.md", windowId: "win-main" });
    assert.equal(core.getActiveDocument()?.id, "doc-lain");
});

// ---- 4. seleksi teks ----------------------------------------------------

test("seleksi teks tersimpan sebagai metadata (panjang + cuplikan pendek)", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({ windowId: "win-main", appId: "app-notepad" });
    const panjang = "paragraf ".repeat(200); // 1800 char
    adapter.selectText({ selectionId: "sel-1", text: panjang, length: 1800, windowId: "win-main" });

    const sel = core.getCurrentSelection();
    assert.equal(sel.type, ENTITY_TYPE.TEXT_SELECTION);
    assert.equal(sel.attributes.length, 1800);
    // Minimisasi: cuplikan dipangkas ke <=120 char oleh adapter.
    assert.ok(sel.attributes.excerpt.length <= 120);
});

// ---- 5. seleksi file -----------------------------------------------------

test("tiga file terpilih di Explorer membentuk grup seleksi", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({ windowId: "win-explorer", appId: "app-explorer" });
    adapter.selectFiles({
        groupId: "fsel-1",
        windowId: "win-explorer",
        files: [
            { id: "f-a", label: "a.txt", path: "C:/data/a.txt" },
            { id: "f-b", label: "b.png", path: "C:/data/b.png" },
            { id: "f-c", label: "c.md", path: "C:/data/c.md" }
        ]
    });

    const group = core.getFileSelectionGroup();
    assert.equal(group.type, ENTITY_TYPE.FILE_SELECTION);
    assert.deepEqual(
        core.getSelectedFiles().map((f) => f.label).sort(),
        ["a.txt", "b.png", "c.md"]
    );
});

// ---- 6. konteks visual ---------------------------------------------------

test("konteks visual berbasis referensi: captureRequired tanpa byte gambar", () => {
    const { core, adapter } = harness();
    adapter.showVisualReference({
        imageId: "img-1",
        source: "active_file",
        sourceRef: "C:/gambar/kucing.png",
        width: 800,
        height: 600
    });

    const vis = core.getActiveVisualContext();
    assert.equal(vis.type, ENTITY_TYPE.IMAGE);
    assert.equal(vis.attributes.captureRequired, true);
    assert.ok(!JSON.stringify(vis).includes("base64"));
});

// ---- 7. konteks workspace + terminal --------------------------------------

test("workspace aktif dengan terminal di dalamnya", () => {
    const { core, adapter } = harness();
    adapter.changeWorkspace({
        workspaceId: "ws-aether",
        label: "Aether",
        projectRoot: "C:/workspace/aether"
    });
    adapter.addTerminal({ terminalId: "term-1", cwd: "C:/workspace/aether", workspaceId: "ws-aether" });

    assert.equal(core.getCurrentWorkspace()?.label, "Aether");
    const term = core.getActiveDocument(); // terminal masuk lewat DOCUMENT_CONTEXT_CHANGED
    assert.equal(term?.type, ENTITY_TYPE.TERMINAL);
});

// ---- 8. representasi clipboard ---------------------------------------------

test("clipboard direpresentasikan metadata-only dan TIDAK menyimpan history", () => {
    const { core, adapter } = harness();
    adapter.setClipboardItem({ itemId: "clip-1", contentType: "text/plain", length: 42 });
    assert.equal(core.getClipboardItem()?.attributes.length, 42);

    adapter.setClipboardItem({ itemId: "clip-2", contentType: "text/plain", length: 7 });
    const current = core.getClipboardItem();
    assert.equal(current.id, "clip-2");
    // Item lama basi — tidak ada daftar history clipboard di mana pun.
    assert.equal(ContextReferenceResolver.resolve(core.getView(), {
        kind: "entity", entityId: "clip-1"
    }).reasonCode, "STALE_CONTEXT");
});

// ---- 9-10. riwayat transisi & batas -----------------------------------------

test("riwayat transisi mencatat urutan peristiwa", () => {
    const { core, adapter } = harness();
    adapter.activateApplication({});
    adapter.activateWindow({ windowId: "w1", appId: "app-notepad" });
    adapter.selectText({ selectionId: "s1", text: "x", length: 1, windowId: "w1" });

    const types = core.getTransitionHistory().map((t) => t.transitionType);
    assert.deepEqual(types, [
        TRANSITION.WINDOW_ACTIVATED,
        TRANSITION.SELECTION_CHANGED
    ]);
});

test("riwayat transisi berbatas dan menandai pemangkasan", () => {
    const { core, adapter } = harness({ maxHistory: 3 });
    for (let i = 1; i <= 6; i++) {
        adapter.changeWorkspace({ workspaceId: `ws-${i}`, label: `ws${i}` });
    }
    const hist = core.getTransitionHistory();
    assert.equal(hist.length, 3);
    assert.equal(core.getView().historyTruncated, true);
    // Yang tertinggal adalah tiga transisi TERBARU.
    assert.deepEqual(hist.map((t) => t.subjectIds[0]), ["ws-4", "ws-5", "ws-6"]);
});

// ---- 11-12. snapshot immutable & pemisahan live ------------------------------

test("snapshot immutable: pembekuan dalam dan tidak berubah saat core maju", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({ windowId: "w1", appId: "a1", documentId: "d1" });
    const snap = core.snapshot();

    assert.equal(Object.isFrozen(snap), true);
    assert.equal(Object.isFrozen(snap.active), true);
    assert.equal(Object.isFrozen(snap.entities), true);
    assert.equal(Object.isFrozen(snap.entities[0]), true);

    adapter.openDocument({ documentId: "d2", path: "/x", windowId: "w1" });
    // Snapshot lama tetap memandang d1; core sudah melihat d2.
    assert.equal(snap.active.documentId.id, "d1");
    assert.equal(core.getActiveDocument()?.id, "d2");
    assert.notEqual(snap.sourceVersion, core.version);
});

// ---- 13. idempotensi observasi duplikat ----------------------------------------

test("observasi dengan id duplikat ditolak idempoten", () => {
    const { core } = harness();
    const obs = {
        type: DESKTOP_EVENT.WORKSPACE_CHANGED,
        observationId: "obs-same",
        timestamp: 1234,
        source: { adapterId: "fake-desktop", trusted: true },
        subject: "ws-x",
        entities: [{ id: "ws-x", type: ENTITY_TYPE.WORKSPACE, label: "x" }],
        relationships: [],
        payload: {}
    };

    const first = core.ingest(obs);
    const versionAfterFirst = core.version;
    const second = core.ingest(obs);

    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.reasonCode, "DUPLICATE_OBSERVATION");
    assert.equal(core.version, versionAfterFirst);
});

// ---- 14. invalidasi konteks basi --------------------------------------------------

test("seleksi yang digantikan menjadi basi dengan alasan deterministik", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({ windowId: "w1", appId: "a1" });
    adapter.selectText({ selectionId: "s-old", text: "lama", length: 4, windowId: "w1" });
    adapter.selectText({ selectionId: "s-new", text: "baru", length: 4, windowId: "w1" });

    assert.equal(core.getCurrentSelection()?.id, "s-new");
    const r = ContextReferenceResolver.resolve(core.getView(), {
        kind: "entity", entityId: "s-old"
    });
    assert.equal(r.status, "unavailable");
    assert.equal(r.reasonCode, "STALE_CONTEXT");
});

// ---- 15. menutup jendela menginvalidasi anak ----------------------------------------

test("window close menginvalidasi dokumen/seleksi/visual anaknya", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({
        windowId: "w1",
        appId: "app-notepad",
        documentId: "doc-1",
        documentPath: "/c.txt"
    });
    adapter.selectText({ selectionId: "sel-1", text: "abc", length: 3, windowId: "w1" });
    adapter.showVisualReference({ imageId: "img-1", windowId: "w1", sourceRef: "x.png" });

    adapter.closeWindow({ windowId: "w1" });

    assert.equal(core.getActiveWindow(), null);
    assert.equal(core.getActiveDocument(), null);
    assert.equal(core.getCurrentSelection(), null);
    assert.equal(core.getActiveVisualContext(), null);

    for (const id of ["w1", "doc-1", "sel-1", "img-1"]) {
        const e = core.getView().entities.get(id);
        assert.equal(e.invalid, true, `${id} harus basi`);
        assert.match(e.staleReason, /WINDOW_CLOSED|SUPERSEDED_SELECTION|SUPERSEDED_DOCUMENT/);
    }
});

// ---- 16. relasi semantik --------------------------------------------------------------

test("relasi semantik terbangun: dokumen displayed_in jendela, opened_by aplikasi", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({
        windowId: "w1",
        appId: "app-notepad",
        documentId: "doc-1"
    });

    const rels = core.getView().relationships;
    assert.ok(rels.some((r) => r.from === "doc-1" && r.relation === "displayed_in" && r.to === "w1"));
    assert.ok(rels.some((r) => r.from === "w1" && r.relation === "active_in" && r.to === "app-notepad"));
});

// ---- 26. event cacat ditolak diagnostik --------------------------------------------------

test("event cacat ditolak dengan kode diagnostik, tidak pernah diterima diam-diam", () => {
    const { core } = harness();

    const cases = [
        [{ type: "bukan-event" }, "MALFORMED_EVENT_UNKNOWN_TYPE"],
        [{
            type: DESKTOP_EVENT.WINDOW_ACTIVATED,
            observationId: "",
            timestamp: 1,
            source: { adapterId: "fake-desktop" }
        }, "MALFORMED_EVENT_NO_OBSERVATION_ID"],
        [{
            type: DESKTOP_EVENT.WINDOW_ACTIVATED,
            observationId: "o1",
            timestamp: "kemarin",
            source: { adapterId: "fake-desktop" }
        }, "MALFORMED_EVENT_BAD_TIMESTAMP"],
        [{
            type: DESKTOP_EVENT.WINDOW_ACTIVATED,
            observationId: "o2",
            timestamp: 5,
            source: { adapterId: "tak-terdaftar" }
        }, "REJECTED_UNTRUSTED_SOURCE"]
    ];

    for (const [raw, expectedCode] of cases) {
        const r = core.ingest(raw);
        assert.equal(r.accepted, false);
        assert.equal(r.reasonCode, expectedCode);
    }

    assert.equal(core.getDiagnostics().length, cases.length);
    assert.equal(core.version, 0);
});

// ---- 27. konteks tak dikenal disimpan aman -------------------------------------------------

test("entitas UNKNOWN disimpan aman tanpa merusak akses aktif", () => {
    const { core } = harness();
    const r = core.ingest({
        type: DESKTOP_EVENT.DOCUMENT_CONTEXT_CHANGED,
        observationId: "obs-unknown",
        timestamp: 777,
        source: { adapterId: "fake-desktop", trusted: true },
        subject: "thing-1",
        entities: [{ id: "thing-1", type: ENTITY_TYPE.UNKNOWN, label: "?", confidence: 0.3 }],
        relationships: [],
        payload: {}
    });

    assert.equal(r.accepted, true);
    assert.equal(core.getActiveDocument()?.id, "thing-1");
    const snap = core.snapshot();
    assert.ok(snap.entities.some((e) => e.type === ENTITY_TYPE.UNKNOWN));
});

// ---- 28. lifecycle adapter fake ---------------------------------------------------------------

test("lifecycle FakeDesktopAdapter: start/stop ketat, emit di luar siklus ditolak", () => {
    const sent = [];
    const adapter = new FakeDesktopAdapter({ emit: (o) => sent.push(o) });

    assert.throws(() => adapter.activateApplication({}), /start/);

    adapter.start();
    assert.equal(adapter.isRunning, true);
    assert.throws(() => adapter.start(), /ganda/);

    adapter.activateApplication({});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].source.adapterId, "fake-desktop");

    adapter.stop();
    assert.equal(adapter.isRunning, false);
    assert.throws(() => adapter.activateApplication({}), /stop/);
    assert.equal(sent.length, 1);
});

test("WindowsActiveWindowAdapter: platform guard dan capability metadata-only", () => {
    const adapter = new WindowsActiveWindowAdapter({ emit: () => {} });

    assert.deepEqual(adapter.capabilities, ["active_window_metadata"]);

    if (process.platform !== "win32") {
        assert.throws(() => adapter.start(), (err) => err.code === "UNSUPPORTED_PLATFORM");
    } else {
        adapter.start();
        assert.equal(adapter.isRunning, true);
        adapter.stop();
        assert.equal(adapter.isRunning, false);
    }
});

// ---- serialisasi/rebuild parity (35) -------------------------------------------

test("serialize/deserialize menghasilkan snapshot identik yang frozen", () => {
    const { core, adapter } = harness();
    adapter.activateWindow({ windowId: "w1", appId: "a1", documentId: "d1" });
    adapter.selectText({ selectionId: "s1", text: "teks", length: 4, windowId: "w1" });

    const snap = core.snapshot();
    const json = ContextSnapshot.serialize(snap);
    const rebuilt = ContextSnapshot.deserialize(json);

    assert.equal(rebuilt.desktopContextId, snap.desktopContextId);
    assert.deepEqual(JSON.parse(json), JSON.parse(ContextSnapshot.serialize(rebuilt)));
    assert.equal(Object.isFrozen(rebuilt), true);
    assert.equal(rebuilt.entities.length, snap.entities.length);
});
