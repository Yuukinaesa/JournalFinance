/**
 * Authentication & Cloud Sync Manager for JournalFinance
 * Connecting to Cloudflare Workers Backend
 */

const WORKER_URL = 'https://catatan.arfan-hidayat-priyantono.workers.dev';

const API_CONFIG = {
    // Logic Dual Support:
    // 1. Cloudflare / Production -> Relative Path
    // 2. Localhost -> Local Backend (8787)
    BASE_URL: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://127.0.0.1:8787'
        : (window.location.hostname.includes('workers.dev') ? '' : WORKER_URL),
    TIMEOUT: 30000 // 30 seconds timeout for all requests
};

/**
 * UTILITY: Fetch with Timeout
 * Prevents indefinite hang on network failures
 */
function fetchWithTimeout(url, options = {}, timeout = API_CONFIG.TIMEOUT) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout (30s exceeded)')), timeout)
        )
    ]);
}

class Auth {
    static getToken() {
        return localStorage.getItem('auth_token');
    }

    static getUser() {
        const user = localStorage.getItem('auth_user');
        return user ? JSON.parse(user) : null;
    }

    static isAuthenticated() {
        const token = this.getToken();
        if (!token) return false;

        if (this.isTokenExpired(token)) {
            this.logout();
            return false;
        }

        return true;
    }

    static isTokenExpired(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            const payload = JSON.parse(jsonPayload);

            // Check if expired (exp is in seconds)
            if (!payload.exp) return false; // No expiry set?
            return Date.now() >= payload.exp * 1000;
        } catch (e) {
            console.warn('Error checking token expiry:', e);
            return true; // Assume expired on error
        }
    }

    static async register(email, password, username = null) {
        try {
            const body = { email, password };
            if (username) body.username = username;

            const response = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
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
            const response = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login gagal');

            // Save Session
            localStorage.setItem('auth_token', data.token);
            localStorage.setItem('auth_refresh_token', data.refreshToken);
            localStorage.setItem('auth_user', JSON.stringify(data.user));

            return data;
        } catch (e) {
            console.error('Login Error:', e);
            throw e;
        }
    }


    static logout() {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_refresh_token');
        localStorage.removeItem('auth_user');
        // Redirect handled by caller or window location reload
    }

    static async logoutAll() {
        if (!this.isAuthenticated()) return { success: false, error: 'Not authenticated' };
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/auth/logout-all`, {
                method: 'POST',
                headers: this.getHeaders()
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Server returned ' + res.status);
            }
            return { success: true };
        } catch (e) {
            console.error('Logout All Failed:', e);
            return { success: false, error: e.message };
        }
    }

    static getHeaders() {
        const token = this.getToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    // --- REFRESH TOKEN LOGIC ---

    static getRefreshToken() {
        return localStorage.getItem('auth_refresh_token');
    }

    static async refreshSession() {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token available');

        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken })
            });

            if (!res.ok) throw new Error('Refresh failed');

            const data = await res.json();
            localStorage.setItem('auth_token', data.token); // Update Access Token
            // If new refresh token is provided, update it too (rotation)
            if (data.refreshToken) localStorage.setItem('auth_refresh_token', data.refreshToken);

            return data.token;
        } catch (e) {
            console.error('Session refresh failed:', e);
            this.logout();
            throw e;
        }
    }

    static async ensureToken() {
        const token = this.getToken();
        if (!token) return; // Let downstream handle missing token (401)

        if (this.isTokenExpired(token)) {
            // Token expired, try refresh
            try {
                // If we have a refresh token, try to use it
                if (this.getRefreshToken()) {
                    await this.refreshSession();
                } else {
                    // No refresh token, just expire
                    // this.logout(); // Optional: let 401 handle it
                }
            } catch (e) {
                // Refresh failed
                this.logout();
                window.location.replace('login.html');
                throw new Error('Session expired');
            }
        }
    }

    // --- FULL CLOUD API ---

    static async fetchEntries() {
        await this.ensureToken();
        if (!this.isAuthenticated()) return [];
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/entries`, {
                headers: this.getHeaders()
            });
            if (res.status === 401) {
                // Retry once if 401? Or assume ensureToken handled it.
                // If 401 happens despite ensureToken, it means refresh token also dead
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
        await this.ensureToken();
        if (!this.isAuthenticated()) return null;
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/entries/${id}/image`, {
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
        await this.ensureToken();
        if (!this.isAuthenticated()) throw new Error('Unauthorized');
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/entries`, {
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
        await this.ensureToken();
        if (!this.isAuthenticated()) throw new Error('Unauthorized');
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/entries/${id}`, {
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

    // Helper for updatePreferences (added previously, needs ensureToken)
    static async updatePreferences(preferences) {
        await this.ensureToken();
        if (!this.isAuthenticated()) return;
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/user/preferences`, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify({ preferences })
            });

            if (!res.ok) throw new Error('Failed to update preferences');
            const json = await res.json();

            // Update local user object
            const user = this.getUser();
            if (user) {
                user.preferences = json.preferences;
                localStorage.setItem('auth_user', JSON.stringify(user));
            }
            return json.preferences;
        } catch (e) {
            console.error('Update Preferences Error:', e);
            throw e;
        }
    }

    static async syncWithCloud(entries) {
        await this.ensureToken();
        if (!this.isAuthenticated()) return [];
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/data/sync`, {
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
        await this.ensureToken();
        if (!this.isAuthenticated()) return;
        try {
            const res = await fetchWithTimeout(`${API_CONFIG.BASE_URL}/api/data/reset`, {
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
