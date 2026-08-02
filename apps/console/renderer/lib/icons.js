/**
 * Ikon garis, ditulis inline.
 *
 * Console harus jalan sepenuhnya offline (dan di PC rumah tanpa
 * internet), jadi tidak ada icon font atau CDN — semuanya SVG
 * stroke 1.6px dengan viewBox 24 agar konsisten di segala ukuran.
 */

const paths = {

    dashboard: '<rect x="3" y="3" width="7.5" height="8.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect x="3" y="14.5" width="7.5" height="6.5" rx="2"/>',

    chat: '<path d="M20.5 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-4.7A8.5 8.5 0 1 1 20.5 12Z"/>',

    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/><path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21"/>',

    plug: '<path d="M9 3v6M15 3v6"/><path d="M6.5 9h11v3a5.5 5.5 0 0 1-11 0V9Z"/><path d="M12 17.5V21"/>',

    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/>',

    camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.2-2h6l1.2 2h1.8A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5Z"/><circle cx="12" cy="13" r="3.4"/>',

    box: '<path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7Z"/><path d="M3.5 7 12 11.4 20.5 7M12 11.4V21.2"/>',

    tool: '<path d="M14.7 6.3a4.5 4.5 0 0 0 5.9 5.9l-8.4 8.4a2.4 2.4 0 0 1-3.4-3.4Z"/><path d="m17.5 3.5 3 3-2 2-3-3Z"/>',

    terminal: '<rect x="2.8" y="4" width="18.4" height="16" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',

    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9.1a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.37Z"/>',

    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',

    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',

    play: '<path d="M7.5 4.8 19 12 7.5 19.2Z"/>',

    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',

    send: '<path d="m4 12 16-8-5.5 16-3-6.5Z"/><path d="m11.5 13.5 8.5-9.5"/>',

    trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5"/>',

    plus: '<path d="M12 5v14M5 12h14"/>',

    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',

    x: '<path d="M6 6l12 12M18 6 6 18"/>',

    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',

    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',

    download: '<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2"/>',

    server: '<rect x="3" y="4" width="18" height="6.5" rx="2"/><rect x="3" y="13.5" width="18" height="6.5" rx="2"/><path d="M7 7.2h.01M7 16.8h.01"/>',

    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95 5.5 5.5 0 0 0-10.6-1.2A3.75 3.75 0 0 0 7 18.5Z"/>',

    folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z"/>',

    sensor: '<circle cx="12" cy="12" r="2.5"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6"/><path d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 18.5a9.2 9.2 0 0 0 0-13"/>',

    minimize: '<path d="M5 12h14"/>',

    maximize: '<rect x="5" y="5" width="14" height="14" rx="2"/>',

    restore: '<rect x="4.5" y="7.5" width="12" height="12" rx="2"/><path d="M8 7.5V6a1.5 1.5 0 0 1 1.5-1.5H18A1.5 1.5 0 0 1 19.5 6v8.5A1.5 1.5 0 0 1 18 16h-1.5"/>',

    close: '<path d="M6 6l12 12M18 6 6 18"/>',

    alert: '<path d="M12 8.5v5M12 17h.01"/><path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',

    link: '<path d="M10 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7L11.3 6.5"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.7-1.7"/>',

    brain: '<path d="M12 4.5a3 3 0 0 0-5.6-1.4A2.8 2.8 0 0 0 3.6 6a3 3 0 0 0-.6 4.4A3 3 0 0 0 3.4 15a2.9 2.9 0 0 0 2.3 3.4A2.9 2.9 0 0 0 12 19.5Z"/><path d="M12 4.5a3 3 0 0 1 5.6-1.4A2.8 2.8 0 0 1 20.4 6a3 3 0 0 1 .6 4.4A3 3 0 0 1 20.6 15a2.9 2.9 0 0 1-2.3 3.4A2.9 2.9 0 0 1 12 19.5Z"/>',

    orb: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',

    home: '<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V10"/>'

};

/** Kembalikan markup SVG untuk sebuah ikon. */
export function icon(name, className = "icon") {

    const body = paths[name];

    if (!body) {
        return "";
    }

    return `<svg class="${className}" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.6"
        stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true">${body}</svg>`;

}

/** Lambang Aether: berlian berlapis dengan gradasi aksen. */
export function brandMark(size = 20) {

    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
            <linearGradient id="aether-mark" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0%" stop-color="#22d3ee"/>
                <stop offset="55%" stop-color="#7c8cff"/>
                <stop offset="100%" stop-color="#c084fc"/>
            </linearGradient>
        </defs>
        <path d="M12 1.6 22.4 12 12 22.4 1.6 12Z" stroke="url(#aether-mark)" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M12 6.4 17.6 12 12 17.6 6.4 12Z" fill="url(#aether-mark)" opacity="0.85"/>
    </svg>`;

}
