function home() {
    window.location.href = 'https://wndx2.github.io/';
} 

document.addEventListener('DOMContentLoaded', function () {
    document.body.style.opacity = 1;
    document.querySelectorAll('a.button').forEach(function(link) {
        link.addEventListener('click', function(e) {
            // Only fade for internal links
            if (link.hostname === window.location.hostname) {
                e.preventDefault();
                document.body.classList.add('fade-out');
                setTimeout(function() {
                    window.location = link.href;
                }, 400); // match CSS transition duration
            }
        });
    });
});