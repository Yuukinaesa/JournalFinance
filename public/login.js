// Login Page Logic

document.addEventListener('DOMContentLoaded', () => {
    // Service Worker Cleanup
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
            for (let registration of registrations) {
                registration.unregister();
            }
        });
    }

    // Redirect if already logged in
    if (typeof Auth !== 'undefined' && Auth.isAuthenticated()) {
        window.location.replace('./');
        return;
    }

    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    // Loading State
    btn.innerHTML = 'Memproses...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        await Auth.login(email, password);

        // Success
        btn.innerHTML = 'Berhasil!';
        btn.style.background = '#10b981';

        setTimeout(() => {
            window.location.replace('./?t=' + Date.now());
        }, 500);

    } catch (err) {
        console.error(err);
        if (err.message === 'Failed to fetch') {
            AuthUI.showToast('Gagal terhubung ke server. Periksa koneksi internet.');
        } else {
            AuthUI.showToast(err.message || 'Login gagal.');
        }

        // Reset Button
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.background = ''; // Reset to gradient from CSS
    }
}
