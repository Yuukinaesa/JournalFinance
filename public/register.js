// Register Page Logic

document.addEventListener('DOMContentLoaded', () => {
    // Redirect if already logged in
    if (typeof Auth !== 'undefined' && Auth.isAuthenticated()) {
        window.location.replace('./');
        return;
    }

    const form = document.getElementById('registerForm');
    if (form) {
        form.addEventListener('submit', handleRegister);
    }
});

async function handleRegister(e) {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    if (password.length < 8) {
        AuthUI.showToast('Password minimal 8 karakter');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    // Loading
    btn.innerHTML = 'Mendaftarkan...';
    btn.disabled = true;

    try {
        await Auth.register(email, password, username);
        AuthUI.showToast('Registrasi berhasil! Silakan login.', 'success');

        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);

    } catch (err) {
        console.error(err);
        AuthUI.showToast('Gagal daftar: ' + (err.message || 'Error'));

        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}
