/**
 * Authentication & Cloud Sync Manager for JournalFinance
 * Connecting to Cloudflare Workers Backend
 */

const WORKER_URL = 'https://catatan.arfan-hidayat-priyantono.workers.dev';

const API_CONFIG = {
    // Logic Dual Support:
    // 1. Jika dibuka dari Cloudflare (workers.dev) -> Gunakan Relative Path (lebih cepat)
    // 2. Jika dibuka dari GitHub Pages / Localhost -> Gunakan Absolute URL
    BASE_URL: window.location.hostname.includes('workers.dev') ? '' : WORKER_URL
};

class Auth {
    static getToken() {
        return localStorage.getItem('auth_token');
    }

    static getUser() {
        const user = localStorage.getItem('auth_user');
        return user ? JSON.parse(user) : null;
    }

    static isAuthenticated() {
        return !!this.getToken();
    }

    static async register(email, password) {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Registrasi gagal');
            return data;
        } catch (e) {
            console.error('Register Error:', e);
            throw e;
        }
    }

    static async login(email, password) {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login gagal');

            // Save Session
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_user', JSON.stringify(data.user));

            return data;
        } catch (e) {
            console.error('Login Error:', e);
            throw e;
        }
    }



    static logout() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        // Redirect handled by caller (app.js) to allow for DB cleanup
    }

    static getHeaders() {
        const token = this.getToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    // --- FULL CLOUD API ---

    static async fetchEntries() {
        if (!this.isAuthenticated()) return [];
        try {
            const res = await fetch(`${API_CONFIG.BASE_URL}/api/entries`, {
                headers: this.getHeaders()
            });
            if (res.status === 401) {
                this.logout();
                window.location.replace('login.html');
                return [];
            }
            if (!res.ok) throw new Error('Failed to fetch entries');
            const json = await res.json();
            return json.success ? json.data : [];
        } catch (e) {
            console.error('Fetch Entries Error:', e);
            throw e;
        }
    }

    static async fetchImage(id) {
        if (!this.isAuthenticated()) return null;
        try {
            const res = await fetch(`${API_CONFIG.BASE_URL}/api/entries/${id}/image`, {
                headers: this.getHeaders()
            });
            if (!res.ok) return null;
            const json = await res.json();
            return json.success ? json.imageData : null;
        } catch (e) {
            return null;
        }
    }

    static async saveEntry(entry) {
        if (!this.isAuthenticated()) throw new Error('Unauthorized');
        try {
            const res = await fetch(`${API_CONFIG.BASE_URL}/api/entries`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(entry)
            });

            if (res.status === 401) {
                this.logout();
                window.location.replace('login.html');
                throw new Error('Unauthorized');
            }

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to save');
            }
            return await res.json();
        } catch (e) {
            console.error('Save Entry Error:', e);
            throw e;
        }
    }

    static async deleteEntry(id) {
        if (!this.isAuthenticated()) throw new Error('Unauthorized');
        try {
            const res = await fetch(`${API_CONFIG.BASE_URL}/api/entries/${id}`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });

            if (res.status === 401) {
                this.logout();
                window.location.replace('login.html');
                throw new Error('Unauthorized');
            }

            if (!res.ok) throw new Error('Failed to delete');
            return true;
        } catch (e) {
            console.error('Delete Entry Error:', e);
            throw e;
        }
    }

    static async syncWithCloud(entries) {
        if (!this.isAuthenticated()) return [];
        try {
            const res = await fetch(`${API_CONFIG.BASE_URL}/api/data/sync`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ entries })
            });

            if (res.status === 401) {
                this.logout();
                window.location.replace('login.html');
                return [];
            }

            if (!res.ok) throw new Error('Sync failed');
            const json = await res.json();
            return json.success ? json.entries : [];
        } catch (e) {
            console.error('Sync Error:', e);
            throw e;
        }
    }

    static async resetCloud() {
        if (!this.isAuthenticated()) return;
        try {
            const res = await fetch(`${API_CONFIG.BASE_URL}/api/data/reset`, {
                method: 'DELETE',
                headers: this.getHeaders()
            });

            if (res.status === 401) {
                this.logout();
                window.location.replace('login.html');
                return;
            }

            if (!res.ok) throw new Error('Gagal menghapus data cloud');
            return await res.json();
        } catch (e) {
            console.error('Reset Cloud Error:', e);
            throw e;
        }
    }
}

// Global expose
window.Auth = Auth;
