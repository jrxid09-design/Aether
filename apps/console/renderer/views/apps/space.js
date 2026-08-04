import { createApp } from "../../lib/appHost.js";
import { home } from "../home.js";
import { vision } from "../vision.js";
import { nas } from "../nas.js";
import { family } from "../family.js";

/** Ruang — Rumah + Vision + NAS + Keluarga jadi satu aplikasi. */
export function buildSpaceApp(onBack) {
    return createApp({
        id: "space", label: "Ruang", icon: "home",
        subtitle: "Rumah · Vision · NAS · Keluarga", onBack,
        tabs: [
            { id: "home", label: "Rumah", icon: home.icon, view: home },
            { id: "vision", label: "Vision", icon: vision.icon, view: vision },
            { id: "nas", label: "NAS", icon: nas.icon, view: nas },
            { id: "family", label: "Keluarga", icon: family.icon, view: family }
        ]
    });
}
