#!/usr/bin/env node

const readline = require("node:readline");

const DaemonClient = require("./client");
const { c, symbols, banner } = require("./theme");
const commands = require("./commands");

/**
 * Aether CLI — antarmuka terminal untuk Aether.
 *
 * Berperan sama seperti Console desktop: klien tipis ke daemon.
 * Ngobrol dengan streaming, cek status, kelola model, telusuri
 * memori, jalankan tool — semuanya dari terminal.
 */

function parseArgs(argv) {

    const args = { url: null, token: null, once: null };

    for (let i = 0; i < argv.length; i++) {

        const arg = argv[i];

        if (arg === "--url" || arg === "-u") {
            args.url = argv[++i];
        }
        else if (arg === "--token" || arg === "-t") {
            args.token = argv[++i];
        }
        else if (arg === "--help" || arg === "-h") {
            args.help = true;
        }
        else if (!arg.startsWith("-")) {
            // Sisa argumen = satu pertanyaan sekali jalan (mode pipa).
            args.once = argv.slice(i).join(" ");
            break;
        }

    }

    return args;

}

function usage() {

    console.log(`
${c.text("Aether CLI")}

${c.muted("Pemakaian:")}
  aether                       ${symbols.dot} mode interaktif
  aether "pertanyaan"          ${symbols.dot} tanya sekali lalu keluar
  echo "teks" | aether         ${symbols.dot} baca dari pipa

${c.muted("Opsi:")}
  -u, --url <url>              alamat daemon (default http://localhost:3000)
  -t, --token <token>         AETHER_TOKEN bila daemon dikunci
  -h, --help                  tampilkan bantuan ini

${c.muted("Env:")}
  AETHER_URL, AETHER_TOKEN
`);

}

async function main() {

    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
        usage();
        return;
    }

    const client = new DaemonClient({ url: args.url, token: args.token });

    // Baca dari pipa bila ada (echo "..." | aether).
    const piped = await readPipedInput();

    const oneShot = args.once ?? piped;

    // Sesi percakapan; disimpan agar model punya konteks.
    const session = {
        client,
        messages: [],
        model: null,
        provider: null,
        aborter: null
    };

    if (!(await ensureDaemon(client, { quiet: Boolean(oneShot) }))) {
        process.exitCode = 1;
        return;
    }

    // Ambil provider/model aktif untuk ditampilkan & dipakai.
    try {
        const providers = await client.providers();
        session.provider = providers.active;
        session.model = providers.defaultModel;
    }
    catch {
        // Tidak fatal; chat tetap pakai default daemon.
    }

    if (oneShot) {
        await commands.chat(session, oneShot, { stream: !piped ? true : true });
        process.stdout.write("\n");
        return;
    }

    console.log(banner());

    console.log(
        `  ${symbols.ok} ${c.muted("terhubung ke")} ${c.text(client.baseUrl)}` +
        `   ${symbols.dot} ${c.muted("provider")} ${c.accent(session.provider ?? "?")}` +
        `   ${symbols.dot} ${c.muted("model")} ${c.accent(session.model ?? "default")}`
    );

    console.log(
        `  ${c.dim("ketik")} ${c.accent2("/help")} ${c.dim("untuk perintah, atau langsung ngobrol. ")}` +
        `${c.accent2("/exit")} ${c.dim("untuk keluar.")}\n`
    );

    await repl(session);

}

/** Loop baca-eval-cetak. */
function repl(session) {

    return new Promise(resolve => {

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: `${symbols.you} `,
            historySize: 200
        });

        session.rl = rl;

        rl.prompt();

        rl.on("line", async (line) => {

            const input = line.trim();

            if (!input) {
                rl.prompt();
                return;
            }

            // Ctrl-C saat streaming membatalkan jawaban, bukan CLI.
            try {

                if (input.startsWith("/")) {

                    const done = await commands.handle(session, input);

                    if (done === "exit") {
                        rl.close();
                        return;
                    }

                }
                else {
                    await commands.chat(session, input);
                }

            }
            catch (error) {
                console.log(`  ${symbols.err} ${c.danger(error.message)}`);
            }

            rl.prompt();

        });

        rl.on("close", () => {
            console.log(`\n${c.muted("  Sampai jumpa.")} ${symbols.aether}\n`);
            resolve();
        });

        // Ctrl-C: kalau ada stream jalan, batalkan; kalau tidak, keluar.
        rl.on("SIGINT", () => {

            if (session.aborter) {
                session.aborter.abort();
                session.aborter = null;
                console.log(c.dim("\n  (dibatalkan)"));
                rl.prompt();
            }
            else {
                rl.close();
            }

        });

    });

}

async function ensureDaemon(client, { quiet = false } = {}) {

    if (await client.ping()) {
        return true;
    }

    if (!quiet) {
        console.log(banner());
    }

    console.log(
        `  ${symbols.err} ${c.danger("Daemon Aether tidak terjangkau di")} ${c.text(client.baseUrl)}\n`
    );
    console.log(`  ${c.muted("Jalankan daemon dulu di terminal lain:")}`);
    console.log(`     ${c.accent("npm start")}\n`);
    console.log(`  ${c.muted("Atau arahkan CLI ke alamat lain:")}`);
    console.log(`     ${c.accent("aether --url http://192.168.1.20:3000")}\n`);

    return false;

}

function readPipedInput() {

    return new Promise(resolve => {

        // Tidak ada pipa (stdin adalah TTY) → interaktif.
        if (process.stdin.isTTY) {
            return resolve(null);
        }

        let data = "";

        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => (data += chunk));
        process.stdin.on("end", () => resolve(data.trim() || null));

        // Jangan menggantung bila stdin tidak pernah menutup.
        setTimeout(() => resolve(data.trim() || null), 500).unref?.();

    });

}

main().catch(error => {
    console.error(`${symbols.err} ${c.danger(error.stack ?? error.message)}`);
    process.exit(1);
});
