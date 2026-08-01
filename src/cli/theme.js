const chalk = require("chalk");

/**
 * Palet warna terminal Aether, disamakan dengan aksen aurora di
 * Console (cyan → ungu) supaya terasa satu produk.
 */
const c = {
    accent: chalk.hex("#22d3ee"),
    accent2: chalk.hex("#7c8cff"),
    accent3: chalk.hex("#c084fc"),
    ok: chalk.hex("#34d399"),
    warn: chalk.hex("#fbbf24"),
    danger: chalk.hex("#fb7185"),
    text: chalk.hex("#e8ecff"),
    muted: chalk.hex("#8d97bd"),
    dim: chalk.hex("#5e6788")
};

const symbols = {
    aether: c.accent("◆"),
    you: c.accent2("›"),
    ok: c.ok("✓"),
    warn: c.warn("!"),
    err: c.danger("✗"),
    dot: c.dim("·"),
    arrow: c.dim("→")
};

/** Banner pembuka; ASCII-nya sama dengan versi daemon. */
function banner(version = "") {

    const art = [
        "     █████╗ ███████╗████████╗██╗  ██╗███████╗██████╗",
        "    ██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗",
        "    ███████║█████╗     ██║   ███████║█████╗  ██████╔╝",
        "    ██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗",
        "    ██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║",
        "    ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝"
    ];

    const lines = art.map((line, index) =>
        // Gradasi baris demi baris dari cyan ke ungu.
        [c.accent, c.accent, c.accent2, c.accent2, c.accent3, c.accent3][index](line)
    );

    return `\n${lines.join("\n")}\n    ${c.muted("Aether CLI")} ${
        version ? c.dim(version) : ""
    }\n`;

}

/** Garis pemisah ber-label, dipakai banner startup daemon/launcher. */
function hr(label = "") {
    if (!label) {
        return c.dim("  " + "─".repeat(56));
    }
    const tail = Math.max(2, 52 - String(label).length);
    return c.dim("  ── ") + c.accent(label) + " " + c.dim("─".repeat(tail));
}

module.exports = { c, symbols, banner, hr };
