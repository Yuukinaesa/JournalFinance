/**
 * ============================================================
 * ConnectionMonitor - Enterprise-Grade Connection Monitor
 * ============================================================
 * Features:
 * - Real-time connection monitoring
 * - Beautiful UI for connection status
 * - Retry mechanism with exponential backoff
 * - Asset protection during poor connectivity
 * ============================================================
 */

const ConnectionMonitor = {
    isOnline: navigator.onLine,
    isConnectedToAPI: true,
    retryCount: 0,
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    checkInterval: null,
    lastSuccessfulPing: Date.now(),
    pendingOperations: [],

    // API endpoint for health check
    API_URL: 'https://catatan.arfan-hidayat-priyantono.workers.dev',

    init() {
        this.createStatusUI();
        this.bindEvents();
        this.startMonitoring();
        console.log('✅ ConnectionMonitor initialized');
    },

    createStatusUI() {
        // Remove existing if any
        const existing = document.getElementById('connectionStatusBanner');
        if (existing) existing.remove();

        // Create banner
        const banner = document.createElement('div');
        banner.id = 'connectionStatusBanner';
        banner.className = 'connection-banner';
        banner.innerHTML = `
            <div class="connection-content">
                <!-- Floating Particles -->
                <div class="connection-particles">
                    <div class="connection-particle"></div>
                    <div class="connection-particle"></div>
                    <div class="connection-particle"></div>
                    <div class="connection-particle"></div>
                    <div class="connection-particle"></div>
                    <div class="connection-particle"></div>
                </div>
                
                <div class="connection-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                        <line x1="12" y1="20" x2="12.01" y2="20"></line>
                    </svg>
                </div>
                <div class="connection-text">
                    <span class="connection-title">⚡ Tidak Ada Koneksi</span>
                    <span class="connection-subtitle">Data tidak dapat disinkronkan. Pastikan koneksi internet aktif.</span>
                </div>
                <button class="connection-retry-btn" id="connectionRetryBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                        <path d="M3 3v5h5"></path>
                    </svg>
                    <span>Coba Lagi</span>
                </button>
            </div>
            <div class="connection-progress">
                <div class="connection-progress-bar"></div>
            </div>
        `;

        document.body.appendChild(banner);

        // Bind retry button
        document.getElementById('connectionRetryBtn').addEventListener('click', () => {
            this.manualRetry();
        });
    },

    bindEvents() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            console.log('🟢 Browser: Online');
            this.checkAPIConnection();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.isConnectedToAPI = false;
            console.log('🔴 Browser: Offline');
            this.showBanner('offline');
        });

        // Visibility change - check connection when user comes back
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.isOnline) {
                this.checkAPIConnection();
            }
        });
    },

    startMonitoring() {
        // Initial check
        this.checkAPIConnection();

        // Periodic check every 30 seconds
        this.checkInterval = setInterval(() => {
            if (this.isOnline) {
                this.checkAPIConnection(true); // Silent check
            }
        }, 30000);
    },

    async checkAPIConnection(silent = false) {
        if (!this.isOnline) {
            this.isConnectedToAPI = false;
            if (!silent) this.showBanner('offline');
            return false;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.API_URL}/api/health`, {
                method: 'GET',
                signal: controller.signal,
                credentials: 'include'
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                this.isConnectedToAPI = true;
                this.retryCount = 0;
                this.lastSuccessfulPing = Date.now();
                this.hideBanner();
                this.processPendingOperations();
                return true;
            } else {
                throw new Error(`API responded with ${response.status}`);
            }
        } catch (error) {
            console.warn('⚠️ API connection check failed:', error.message);
            this.isConnectedToAPI = false;

            if (error.name === 'AbortError') {
                if (!silent) this.showBanner('slow');
            } else {
                if (!silent) this.showBanner('error');
            }

            return false;
        }
    },

    showBanner(type = 'offline') {
        const banner = document.getElementById('connectionStatusBanner');
        if (!banner) return;

        const icon = banner.querySelector('.connection-icon');
        const title = banner.querySelector('.connection-title');
        const subtitle = banner.querySelector('.connection-subtitle');
        const retryBtn = banner.querySelector('.connection-retry-btn');
        const progressBar = banner.querySelector('.connection-progress-bar');

        // Reset classes
        banner.className = 'connection-banner show';

        switch (type) {
            case 'offline':
                banner.classList.add('offline');
                icon.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                        <line x1="12" y1="20" x2="12.01" y2="20"></line>
                    </svg>
                `;
                title.innerHTML = '📡 Tidak Ada Koneksi Internet';
                subtitle.textContent = 'Periksa koneksi WiFi atau data seluler Anda untuk melanjutkan';
                retryBtn.style.display = 'flex';
                break;

            case 'slow':
                banner.classList.add('slow');
                icon.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                `;
                title.innerHTML = '⏳ Koneksi Lambat Terdeteksi';
                subtitle.textContent = 'Jaringan tidak stabil. Sedang mencoba menghubungkan ulang...';
                retryBtn.style.display = 'flex';
                this.startAutoRetry();
                break;

            case 'error':
                banner.classList.add('error');
                icon.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                `;
                title.innerHTML = '⚠️ Server Tidak Merespons';
                subtitle.textContent = 'Terjadi masalah saat menghubungi server. Coba lagi dalam beberapa saat.';
                retryBtn.style.display = 'flex';
                break;

            case 'reconnecting':
                banner.classList.add('reconnecting');
                icon.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spin">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                        <path d="M3 3v5h5"></path>
                    </svg>
                `;
                title.innerHTML = '🔄 Menghubungkan Ulang...';
                subtitle.textContent = `Mencoba koneksi ${this.retryCount} dari ${this.maxRetries}. Mohon tunggu...`;
                retryBtn.style.display = 'none';

                // Show progress
                const progress = (this.retryCount / this.maxRetries) * 100;
                progressBar.style.width = `${progress}%`;
                break;
        }

        // Add animation
        banner.style.animation = 'none';
        banner.offsetHeight; // Trigger reflow
        banner.style.animation = 'slideDownBanner 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
    },

    hideBanner() {
        const banner = document.getElementById('connectionStatusBanner');
        if (!banner) return;

        banner.classList.remove('show');
        banner.style.animation = 'slideUpBanner 0.4s ease forwards';

        setTimeout(() => {
            banner.className = 'connection-banner';
        }, 400);
    },

    async startAutoRetry() {
        if (this.retryCount >= this.maxRetries) {
            console.log('⚠️ Max retries reached');
            this.showBanner('error');
            return;
        }

        this.retryCount++;
        this.showBanner('reconnecting');

        // Exponential backoff
        const delay = this.baseDelay * Math.pow(2, this.retryCount - 1);
        console.log(`🔄 Retry ${this.retryCount}/${this.maxRetries} in ${delay}ms`);

        await this.sleep(delay);

        if (await this.checkAPIConnection(true)) {
            this.showReconnectedToast();
        } else if (this.retryCount < this.maxRetries) {
            this.startAutoRetry();
        }
    },

    manualRetry() {
        this.retryCount = 0;
        this.showBanner('reconnecting');

        setTimeout(async () => {
            if (await this.checkAPIConnection()) {
                this.showReconnectedToast();
            } else {
                this.startAutoRetry();
            }
        }, 500);
    },

    showReconnectedToast() {
        if (window.app && window.app.showToast) {
            window.app.showToast('✅ Koneksi dipulihkan!');
        }
    },

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // ==========================================
    // ASSET PROTECTION - Queue Operations
    // ==========================================

    /**
     * Wraps an async operation with connection checking and queuing
     * @param {Function} operation - The async operation to perform
     * @param {Object} metadata - Metadata for retry/persistence
     * @returns {Promise}
     */
    async withConnectionGuard(operation, metadata = {}) {
        // Check connection first
        if (!this.isOnline) {
            throw new ConnectionError('OFFLINE', 'Tidak ada koneksi internet. Operasi tidak dapat dilakukan dalam mode offline.');
        }

        if (!this.isConnectedToAPI) {
            // Try a quick check
            const connected = await this.checkAPIConnection(true);
            if (!connected) {
                throw new ConnectionError('NO_API', 'Tidak dapat terhubung ke server. Silakan coba lagi.');
            }
        }

        try {
            return await operation();
        } catch (error) {
            // Check if it's a network error
            if (this.isNetworkError(error)) {
                this.isConnectedToAPI = false;
                this.showBanner('error');
                throw new ConnectionError('NETWORK_ERROR', 'Koneksi terputus saat operasi berlangsung. Data mungkin tidak tersimpan.');
            }
            throw error;
        }
    },

    isNetworkError(error) {
        return (
            error.name === 'TypeError' && error.message.includes('fetch') ||
            error.name === 'AbortError' ||
            error.message.includes('network') ||
            error.message.includes('Network') ||
            error.message.includes('Failed to fetch')
        );
    },

    addPendingOperation(operation) {
        this.pendingOperations.push({
            ...operation,
            timestamp: Date.now()
        });
    },

    async processPendingOperations() {
        if (this.pendingOperations.length === 0) return;

        console.log(`🔄 Processing ${this.pendingOperations.length} pending operations`);

        const operations = [...this.pendingOperations];
        this.pendingOperations = [];

        for (const op of operations) {
            try {
                await op.execute();
            } catch (error) {
                console.error('Failed to process pending operation:', error);
                // Re-add to queue if still failing
                this.pendingOperations.push(op);
            }
        }
    },

    // Check if we should block operations
    shouldBlockOperation() {
        return !this.isOnline || !this.isConnectedToAPI;
    },

    // Get connection status for UI
    getStatus() {
        return {
            isOnline: this.isOnline,
            isConnectedToAPI: this.isConnectedToAPI,
            lastSuccessfulPing: this.lastSuccessfulPing,
            pendingOperations: this.pendingOperations.length
        };
    }
};

// Custom Error Class
class ConnectionError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ConnectionError';
        this.code = code;
    }
}

// Auto-initialize on load
document.addEventListener('DOMContentLoaded', () => {
    ConnectionMonitor.init();
});

// Export for use
window.ConnectionMonitor = ConnectionMonitor;
window.ConnectionError = ConnectionError;
