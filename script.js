document.addEventListener('DOMContentLoaded', () => {
    // ── KEYBOARD SHORTCUTS ───────────────────────────────────────
    document.addEventListener("keydown", (event) => {
        // leave browser shortcuts (cmd+c, ctrl+l, ...) alone
        if (event.metaKey || event.ctrlKey || event.altKey) return;

        const shortcuts = {
            'c': "https://classroom.google.com/u/1/?pli=1",
            'k': "https://otc.school.kiwi/",
            'd': "https://drive.google.com/drive/u/1/my-drive",
            'm': "https://mail.google.com/mail/u/1/#inbox",
            'n': "https://sleepywndud.github.io",
            'l': "https://lucasis.pro",
            'g': "https://github.com/wndx2",
            'a': "https://wndx2.github.io/arki"
        };

        const url = shortcuts[event.key.toLowerCase()];
        if (url) {
            if (Array.isArray(url)) {
                url.forEach(link => window.open(link, "_blank"));
            } else {
                window.open(url, "_blank");
            }
        }
    });
});