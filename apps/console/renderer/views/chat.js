import { store } from "../lib/store.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { esc, markdown, toast, clockTime } from "../lib/ui.js";
import { aiChoices } from "../lib/aiselect.js";

let scrollHost = null;

/** Ditahan agar tombol Stop bisa membekukan gelembung yang sedang tumbuh. */
let streamingBubble = null;

export const chat = {

    id: "chat",
    label: "Chat",
    icon: "chat",
    title: "Chat",
    subtitle: "Bicara langsung dengan AI yang sedang aktif.",

    render(root) {

        root.innerHTML = `
            <div class="view-head">
                <div>
                    <h1>Chat</h1>
                    <p>Bicara langsung dengan AI yang sedang aktif.</p>
                </div>
                <div class="actions">
                    <div class="seg" id="chat-mode" style="margin:0"></div>
                    <select id="chat-model" style="width:230px" title="Model"></select>
                    <button class="btn ghost sm" id="chat-clear">${icon("trash")} Bersihkan</button>
                </div>
            </div>

            <div class="chat-layout">

                <div class="panel flush" style="display:flex;flex-direction:column;min-height:0">
                    <div class="chat-scroll" id="chat-scroll" style="padding:16px"></div>
                </div>

                <div class="composer">
                    <textarea id="chat-input" rows="1"
                        placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"></textarea>
                    <button class="btn primary" id="chat-send">${icon("send")} Kirim</button>
                    <button class="btn danger" id="chat-stop" style="display:none">${icon("stop")} Stop</button>
                </div>

            </div>`;

        scrollHost = root.querySelector("#chat-scroll");

        renderMessages();

    },

    async mount(root) {

        const input = root.querySelector("#chat-input");
        const sendBtn = root.querySelector("#chat-send");
        const stopBtn = root.querySelector("#chat-stop");
        const modeSeg = root.querySelector("#chat-mode");
        const modelSelect = root.querySelector("#chat-model");

        // Selektor AI Lokal / AI Provider; ganti → muat ulang model aktif.
        await aiChoices.render(modeSeg, () => fillModels(modelSelect));

        await fillModels(modelSelect);

        modelSelect.addEventListener("change", async () => {

            try {
                await api.selectModel(modelSelect.value);
                toast(`Model: ${modelSelect.value}`, "ok");
            }
            catch (error) {
                toast(error.message, "danger");
            }

        });

        // Textarea tumbuh mengikuti isi, sampai batas CSS max-height.
        input.addEventListener("input", () => {
            input.style.height = "auto";
            input.style.height = `${Math.min(input.scrollHeight, 190)}px`;
        });

        input.addEventListener("keydown", event => {

            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
            }

        });

        sendBtn.addEventListener("click", send);

        stopBtn.addEventListener("click", () => {

            api.stopChat();

            settle(store.get().chat.messages.at(-1), "dihentikan");

        });

        /**
         * Satu-satunya tempat status "sedang streaming" dilepas —
         * dipakai oleh jalur sukses, error, maupun tombol Stop
         * supaya tombol tidak pernah tertinggal di posisi salah.
         */
        function settle(message, note) {

            if (message && message.role === "assistant") {
                message.streaming = false;
                message.note = note ?? message.note;
            }

            store.get().chat.streaming = false;

            sendBtn.style.display = "inline-flex";
            stopBtn.style.display = "none";

            streamingBubble = null;

            renderMessages();

        }

        root.querySelector("#chat-clear").addEventListener("click", () => {
            store.get().chat.messages = [];
            renderMessages();
        });

        async function send() {

            const text = input.value.trim();

            if (!text) {
                return;
            }

            if (!store.get().connected) {
                toast("Belum terhubung ke daemon.", "warn");
                return;
            }

            input.value = "";
            input.style.height = "auto";

            const conversation = store.get().chat;

            conversation.messages.push({
                role: "user",
                content: text,
                time: new Date().toISOString()
            });

            // Payload disusun SEBELUM placeholder assistant dibuat.
            // Kalau placeholder yang masih kosong ikut terkirim,
            // model membacanya sebagai prefill jawaban dan sering
            // membalas dengan string kosong.
            const payload = conversation.messages
                .filter(message =>
                    message.role !== "system" &&
                    !message.error &&
                    message.content)
                .map(({ role, content }) => ({ role, content }));

            const assistant = {
                role: "assistant",
                content: "",
                time: new Date().toISOString(),
                streaming: true
            };

            conversation.messages.push(assistant);
            conversation.streaming = true;

            renderMessages();

            sendBtn.style.display = "none";
            stopBtn.style.display = "inline-flex";

            streamingBubble = scrollHost.querySelector(".msg:last-child .bubble");

            const started = Date.now();

            try {

                await api.streamChat(
                    {
                        messages: payload,
                        model: modelSelect.value || undefined
                    },
                    ({ event, data }) => {

                        if (event === "chunk" && data.delta) {

                            assistant.content += data.delta;

                            if (streamingBubble) {
                                streamingBubble.innerHTML =
                                    markdown(assistant.content);
                            }

                            scrollToEnd();

                        }

                        else if (event === "error") {

                            assistant.content ||= "";
                            assistant.error = data.message;

                        }

                    }
                );

                settle(
                    assistant,
                    `${((Date.now() - started) / 1000).toFixed(1)}s`
                );

            }

            catch (error) {

                assistant.error = error.message;

                settle(assistant, null);

                toast(error.message, "danger");

            }

        }

        input.focus();

    }

};

async function fillModels(select, provider) {

    select.innerHTML = `<option value="">memuat…</option>`;

    try {

        const data = await api.models(provider);

        const models = data.models ?? [];

        if (models.length === 0) {

            select.innerHTML = `<option value="">tidak ada model</option>`;

            return;

        }

        select.innerHTML = models.map(model => {
            const glyph = model.status === "verified" ? "✓ "
                : (model.tier === "preview" || model.tier === "experimental") ? "⚠ " : "";
            return `<option value="${esc(model.id)}" ${model.id === data.defaultModel ? "selected" : ""}>
                ${glyph}${esc(model.name ?? model.id)}${model.free ? " · free" : ""}
            </option>`;
        }).join("");

    }

    catch (error) {

        select.innerHTML = `<option value="">gagal memuat</option>`;

        toast(`Model: ${error.message}`, "warn");

    }

}

function renderMessages() {

    if (!scrollHost) {
        return;
    }

    const messages = store.get().chat.messages;

    if (messages.length === 0) {

        scrollHost.innerHTML = `
            <div class="empty">
                ${icon("chat")}
                <div style="font-size:14px;color:var(--text)">Mulai percakapan</div>
                <div>Model bisa memanggil tool plugin Aether saat dibutuhkan.</div>
            </div>`;

        return;

    }

    scrollHost.innerHTML = messages.map(message => {

        const role = message.role;

        const avatar = role === "user" ? "You" : "AE";

        const body = message.error
            ? `<span class="danger-text">${esc(message.error)}</span>`
            : (message.content
                ? markdown(message.content)
                : `<span class="dim">menunggu jawaban…</span>`);

        const footnote = [
            clockTime(message.time),
            message.note
        ].filter(Boolean).join(" · ");

        return `
            <div class="msg ${esc(role)}">
                <div class="avatar">${avatar}</div>
                <div>
                    <div class="bubble ${message.streaming ? "typing" : ""}">${body}</div>
                    ${footnote ? `<div class="footnote">${esc(footnote)}</div>` : ""}
                </div>
            </div>`;

    }).join("");

    scrollToEnd();

}

function scrollToEnd() {

    if (scrollHost) {
        scrollHost.scrollTop = scrollHost.scrollHeight;
    }

}
