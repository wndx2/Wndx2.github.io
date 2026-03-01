document.addEventListener('DOMContentLoaded', () => {
    // ── TYPING NAME EFFECT ───────────────────────────────────────
    const nameElement = document.getElementById('name');
    if (!nameElement) {
        console.error("fk you");
        return;
    }

    const names = [
        "wndud", "wnd", "wndu", "wndi", "James",
        "Juyoung", "PARK", "주영", "박주영", "ㅈㅇ",
        "ㅂㅈㅇ", "James Park", "Juyoung Park",
        "James (Juyoung) Park"
    ];

    let nameIndex = Math.floor(Math.random() * names.length);
    let charIndex = 0;
    let isDeleting = false;

    const typingSpeed = 150;
    const deletingSpeed = 100;
    const delayBetweenWords = 2000;

    function type() {
        const currentName = names[nameIndex];
        if (isDeleting) {
            nameElement.textContent = currentName.substring(0, charIndex - 1) || '\u00A0';
            charIndex--;
            if (charIndex === 0) {
                isDeleting = false;
                let newIndex;
                do {
                    newIndex = Math.floor(Math.random() * names.length);
                } while (newIndex === nameIndex);
                nameIndex = newIndex;
                setTimeout(type, 500);
            } else {
                setTimeout(type, deletingSpeed);
            }
        } else {
            nameElement.textContent = currentName.substring(0, charIndex + 1);
            charIndex++;
            if (charIndex === currentName.length) {
                isDeleting = true;
                setTimeout(type, delayBetweenWords);
            } else {
                setTimeout(type, typingSpeed);
            }
        }
    }

    nameElement.textContent = '\u00A0';
    type();

    // ── DVD LOGO BOUNCING WITH CORNER HUE EFFECT ─────────────────
    const logo = document.getElementById("dvd-logo");
    const screen = document.querySelector(".c-center");

    if (!logo || !screen) {
        console.warn("DVD logo or container not found");
        return;
    }

    const startAnimation = () => {
        let vx = 5;
        let vy = 5;

        // Initial dimensions
        const sw = screen.clientWidth;
        const sh = screen.clientHeight;
        const lw = logo.clientWidth;
        const lh = logo.clientHeight;

        // Start position (random, clamped)
        let x = Math.random() * (sw - lw);
        let y = Math.random() * (sh - lh);
        x = Math.max(0, Math.min(x, sw - lw));
        y = Math.max(0, Math.min(y, sh - lh));

        // Track timeout for hue reset
        let hueTimeout = null;

        function animate() {
            const current_sw = screen.clientWidth;
            const current_sh = screen.clientHeight;
            const current_lw = logo.clientWidth;
            const current_lh = logo.clientHeight;

            x += vx;
            y += vy;

            let hitHorizontal = false;
            let hitVertical = false;

            // Horizontal wall check
            if (x <= 0 || x + current_lw >= current_sw) {
                vx = -vx;
                hitHorizontal = true;
            }

            // Vertical wall check
            if (y <= 0 || y + current_lh >= current_sh) {
                vy = -vy;
                hitVertical = true;
            }

            // Corner hit: both bounced this frame
            if (hitHorizontal && hitVertical) {
                // Apply random hue rotation
                const randomHue = Math.floor(Math.random() * 360);
                logo.style.filter = `hue-rotate(${randomHue}deg)`;

                // Clear any existing timeout
                if (hueTimeout) {
                    clearTimeout(hueTimeout);
                }

                // Reset to normal after 2 seconds
                hueTimeout = setTimeout(() => {
                    logo.style.filter = 'none';
                    hueTimeout = null;
                }, 2000);
            }

            logo.style.left = x + "px";
            logo.style.top = y + "px";

            requestAnimationFrame(animate);
        }

        logo.style.left = x + "px";
        logo.style.top = y + "px";
        animate();
    };

    if (logo.complete) {
        startAnimation();
    } else {
        logo.onload = startAnimation;
    }

    // ── KEYBOARD SHORTCUTS ───────────────────────────────────────
    document.addEventListener("keydown", function (event) {
        if (event.key === "c") {
            window.open("https://classroom.google.com/u/1/?pli=1", "_blank");
        } else if (event.key === "k") {
            window.open("https://otc.school.kiwi/", "_blank");
        } else if (event.key === "d") {
            window.open("https://drive.google.com/drive/u/1/my-drive", "_blank");
        } else if (event.key === "v") {
            window.open("https://discord.com/channels/1305436206728740934/", "_blank");
        } else if (event.key === "m") {
            window.open("https://mail.google.com/mail/u/0/#inbox", "_blank");
            window.open("https://mail.google.com/mail/u/1/#inbox", "_blank");
        } else if (event.key === "g") {
            window.open("https://github.com/sleepywndud", "_blank");
            window.open("https://github.com/wndx2", "_blank");
        }
    });

    // ── LIVE TIME ─────────────────────────────────────────────────
    function updateTime() {
        const now = new Date();
        document.getElementById("live-time").textContent = now.toLocaleTimeString(
            [],
            { hour12: false }
        );
    }

    setInterval(updateTime, 10);
    updateTime();
});