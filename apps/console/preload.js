const { contextBridge, ipcRenderer } = require("electron");

/**
 * Permukaan API yang dibuka ke renderer.
 *
 * Renderer berjalan tanpa akses Node, jadi semua yang menyentuh
 * sistem harus lewat sini — daftar ini sengaja sempit dan tidak
 * meneruskan objek ipcRenderer mentah.
 */
contextBridge.exposeInMainWorld("aether", {

    settings: {
        get: () => ipcRenderer.invoke("settings:get"),
        set: (patch) => ipcRenderer.invoke("settings:set", patch)
    },

    window: {
        minimize: () => ipcRenderer.invoke("window:minimize"),
        toggleMaximize: () => ipcRenderer.invoke("window:maximize"),
        close: () => ipcRenderer.invoke("window:close"),
        isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
        onState: (callback) => {
            const handler = (event, state) => callback(state);
            ipcRenderer.on("window:state", handler);
            return () => ipcRenderer.off("window:state", handler);
        }
    },

    daemon: {
        status: () => ipcRenderer.invoke("daemon:status"),
        start: () => ipcRenderer.invoke("daemon:start"),
        stop: () => ipcRenderer.invoke("daemon:stop"),
        onOutput: (callback) => {
            const handler = (event, payload) => callback(payload);
            ipcRenderer.on("daemon:output", handler);
            return () => ipcRenderer.off("daemon:output", handler);
        },
        onExit: (callback) => {
            const handler = (event, payload) => callback(payload);
            ipcRenderer.on("daemon:exit", handler);
            return () => ipcRenderer.off("daemon:exit", handler);
        }
    },

    shell: {
        open: (url) => ipcRenderer.invoke("shell:open", url)
    },

    dialog: {
        error: (title, message) =>
            ipcRenderer.invoke("dialog:error", { title, message })
    }

});
