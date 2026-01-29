/**
 * ============================================================
 * JournalFinance App Logic - OPTIMIZED V2.0
 * ============================================================
 * Features:
 * - Enterprise Grade Security (CSP Compliant, No Inline Handlers)
 * - OptimizedDB Integration
 * - Lazy Image Loading
 * - Event Delegation
 * ============================================================
 */

// ============================================================
// PWA INSTALL PROMPT - Must be registered EARLY before DOMContentLoaded
// ============================================================
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('✅ PWA Install Event captured early!');

    // Show install button if DOM is ready
    const btn = document.getElementById('installBtn');
    if (btn) {
        btn.style.display = 'flex';
    } else {
        // DOM not ready yet, wait for it
        document.addEventListener('DOMContentLoaded', () => {
            const installBtn = document.getElementById('installBtn');
            if (installBtn) installBtn.style.display = 'flex';
        });
    }
});

// Detect iOS for manual install instructions
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

if (isIOS && !isStandalone) {
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('installBtn');
        if (btn) {
            btn.style.display = 'flex';
            btn.title = 'Tap to see iOS install instructions';
        }
    });
}

window.app = {
    STORAGE_KEY: 'journalFinanceData',
    deleteTargetId: null,
    closeTimeout: null,
    db: new OptimizedJournalDB(),
    data: [],
    worker: null,
    deferredPrompt: null, // Will be set from global

    async init() {
        try {
            // AUTH CHECK
            // Ensure Auth is loaded strictly from auth.js before app logic
            if (typeof Auth === 'undefined') {
                console.error('Auth module not loaded');
                return;
            }

            if (!Auth.isAuthenticated()) {
                window.location.replace('login.html');
                return;
            }

            // Cleanup URL params
            if (window.location.search) {
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            // SHOW USER INFO
            this.renderHeaderUser();

            // --- Cloud Init (with Offline Fallback) ---
            this.showProgress(10, 'Memuat Data', 'Menghubungkan ke server...');

            try {
                // Try Cloud First (Authority)
                this.data = await Auth.fetchEntries();
                // Update Local Cache immediately
                await this.db.clearAll();
                await this.db.bulkPut('entries', this.data);
                console.log('✅ Cloud Data Loaded & Cached');
            } catch (e) {
                console.warn('⚠️ Cloud fetch failed, checking local cache...', e);
                // Fallback to Local DB
                try {
                    const localData = await this.db.getAllEntries();
                    if (localData && localData.length > 0) {
                        this.data = localData;
                        this.showToast('⚠️ Offline Mode: Data lokal dimuat');
                    } else {
                        throw new Error('Tidak ada data lokal & Gagal koneksi ke server.');
                    }
                } catch (dbErr) {
                    console.error('Critical Init Error:', dbErr);
                    this.showToast('⚠️ Gagal memuat data (Check Connection)');
                    this.data = [];
                }
            } finally {
                this.hideProgress();
            }

            this.registerServiceWorker();
            this.initTheme();
            this.initEventListeners();
            this.renderList();

            // Background Sync (Every 30 seconds) - Near Real-time
            setInterval(() => this.performSync(), 30000);

            // RESUME CHECK - Keeping for File Restore Only
            if (localStorage.getItem('APP_STATUS') === 'RESTORING') {
                this.resumeRestore();
            }

            // AUTO MIGRATE V1 (LocalStorage) -> V2 (Cloud)
            await this.migrateFromLocalStorage();

        } catch (e) {
            console.error('Core init error:', e);
            this.data = [];
            this.showToast('⚠️ Error initializing app.');
        }
    },

    renderHeaderUser() {
        const user = Auth.getUser();
        if (user && user.email) {
            const existingUserDisplay = document.getElementById('userDisplay');
            if (!existingUserDisplay) {
                const userDiv = document.createElement('div');
                userDiv.id = 'userDisplay';
                userDiv.style.cssText = 'position: absolute; top: 1rem; right: 1rem; font-size: 0.85rem; color: var(--text-muted); background: var(--bg-card); padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px; z-index: 50;';
                userDiv.innerHTML = `
                        <div style="width: 8px; height: 8px; background: #10b981; border-radius: 50%;"></div>
                        <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${user.username || user.email}</span>
                        <a href="#" id="btnLogoutAll" style="color: var(--text-muted); margin-left: 12px; text-decoration: none; font-size: 0.8rem;" title="Keluar semua perangkat">Keluar Semua</a>
                        <a href="#" id="btnLogout" style="color: #ef4444; margin-left: 8px; text-decoration: none; font-weight: 600;">Keluar</a>
                     `;
                document.body.appendChild(userDiv);

                document.getElementById('btnLogout').addEventListener('click', (e) => {
                    e.preventDefault();
                    this.logout();
                });

                document.getElementById('btnLogoutAll').addEventListener('click', async (e) => {
                    e.preventDefault();
                    const confirmed = await this.showConfirm(
                        'Log Out All Devices',
                        'Yakin ingin keluar dari SEMUA perangkat? Anda harus login ulang di semua device.'
                    );
                    if (confirmed) {
                        this.showToast('Memproses logout global...');
                        try {
                            const result = await Auth.logoutAll();
                            if (result.success) {
                                await this.showAlert('Sukses', 'Semua sesi perangkat lain telah diakhiri.');
                            } else {
                                throw new Error(result.error || 'Unknown error');
                            }
                        } catch (err) {
                            await this.showAlert('Gagal', 'Logout global sistem gagal: ' + err.message + '\n\nAnda tetap akan logout dari perangkat ini.');
                        } finally {
                            this.logout();
                            window.onbeforeunload = null;
                            window.location.reload();
                        }
                    }
                });
            }
        }
    },



    logout() {
        this.initiateLogout();
    },

    initWorkerListener() {
        if (!this.worker) return;
        this.worker.onmessage = (e) => {
            const { type, operation, current, total, stage, data, error } = e.data;

            if (type === 'progress') {
                let pct = (current / total) * 100;
                this.updateProgressUI(pct, operation, stage);
            }

            if (type === 'success') {
                this.handleSuccess(operation, data);
            }

            if (type === 'error') {
                this.hideProgress();
                console.error('Worker Error:', error);
                this.showAlert('System Error', 'Terjadi kesalahan: ' + error);
                if (operation === 'restore') localStorage.removeItem('APP_STATUS');
            }
        };
    },

    // --- Unified Progress & Success Handlers ---

    updateProgressUI(pct, operation, stage) {
        let title = '';
        let msg = '';

        if (operation === 'backup') {
            title = 'Membuat Backup...';
            if (stage === 'init') msg = 'Menyiapkan...';
            if (stage === 'fetching_entries') msg = 'Mengumpulkan Catatan...';
            if (stage === 'fetching_images') msg = 'Mengumpulkan Gambar...';
            if (stage === 'compressing') msg = 'Membuat File JSON...';
            if (stage === 'preparing_download') msg = 'Menyiapkan Unduhan...';
        } else if (operation === 'restore') {
            title = 'Restore Data...';
            if (stage === 'parsing') msg = 'Membaca File...';
            if (stage === 'saving_checkpoint') msg = 'Menyimpan Titik Pulih...';
            if (stage === 'clearing_db') msg = 'Membersihkan Database...';
            if (stage.includes('entries')) msg = `Memulihkan Catatan (${Math.floor(pct)}%)...`;
            if (stage.includes('images')) msg = `Memulihkan Gambar (${Math.floor(pct)}%)...`;
        } else if (operation === 'reset') {
            title = 'Reset Data...';
            msg = 'Menghapus database...';
        }

        this.showProgress(pct, title, msg);
    },

    handleSuccess(operation, data) {
        this.showProgress(100, 'Selesai!', 'Operasi berhasil.');
        setTimeout(() => this.hideProgress(), 1000);

        if (operation === 'backup' && data) {
            // Download Blob
            const url = URL.createObjectURL(data);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_JournalFinance_v2_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            this.showToast('✅ Backup Berhasil Diunduh');
        }

        if (operation === 'restore' || operation === 'reset') {
            // Reload data from Cloud
            Auth.fetchEntries().then(entries => {
                this.data = entries;
                this.renderList();

                if (operation === 'restore') {
                    localStorage.removeItem('APP_STATUS');
                    this.showAlert('Restore Berhasil', 'Data telah dipulihkan. Aplikasi akan dimuat ulang untuk memproses data baru.')
                        .then(() => {
                            window.onbeforeunload = null;
                            window.location.reload();
                        });
                } else {
                    this.showToast('✅ Reset Selesai');
                    localStorage.removeItem(this.STORAGE_KEY);
                    localStorage.removeItem('APP_STATUS');
                    this.closeResetModal();
                }
            });
        }
    },

    // --- Progress UI ---
    showProgress(percent, title, msg) {
        const modal = document.getElementById('progressModal');
        const fill = document.getElementById('progressBarFill');
        const txt = document.getElementById('progressPercent');

        modal.classList.add('open');
        if (title) document.getElementById('progressTitle').innerText = title;
        if (msg) document.getElementById('progressMessage').innerText = msg;

        fill.style.width = `${percent}%`;
        txt.innerText = `${Math.floor(percent)}%`;
    },

    hideProgress() {
        document.getElementById('progressModal').classList.remove('open');
    },

    // --- Backup & Utils ---

    async backupData() {
        this.showProgress(0, 'Menyiapkan Backup...', 'Memulai...');

        if (this.worker) {
            this.worker.postMessage({ action: 'backup' });
        } else {
            // Main Thread Fallback
            await this.processBackupMain();
        }
    },

    async processBackupMain() {
        try {
            // 1. Entries
            this.updateProgressUI(10, 'backup', 'fetching_entries');
            // Give UI a moment to render
            await new Promise(r => setTimeout(r, 50));

            const entries = await Auth.fetchEntries();

            // 2. Images
            this.updateProgressUI(40, 'backup', 'fetching_images');
            await new Promise(r => setTimeout(r, 50));

            const images = [];
            let processed = 0;
            const entriesWithImages = entries.filter(e => e.hasImage);
            const totalWithImages = entriesWithImages.length;

            for (const entry of entriesWithImages) {
                try {
                    const imgData = await Auth.fetchImage(entry.id);
                    if (imgData) {
                        images.push({ entryId: entry.id, data: imgData });
                    }
                } catch (err) {
                    console.warn('Failed to backup image for', entry.id);
                }

                processed++;
                const pct = 40 + (processed / totalWithImages * 40);
                this.updateProgressUI(pct, 'backup', 'fetching_images');
            }

            // 3. Serialize
            this.updateProgressUI(90, 'backup', 'compressing');
            await new Promise(r => setTimeout(r, 50));

            const backupData = {
                version: 2,
                timestamp: new Date().toISOString(),
                entries,
                images
            };

            const jsonString = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });

            this.handleSuccess('backup', blob);

        } catch (e) {
            console.error(e);
            this.hideProgress();
            this.showToast('❌ Gagal Backup: ' + e.message);
        }
    },

    resetFilters() {
        document.getElementById('searchInput').value = '';
        document.getElementById('filterType').value = '';
        document.getElementById('dateStart').value = '';
        document.getElementById('dateEnd').value = '';
        this.renderList();
        this.showToast('Filters reset');
    },

    restoreTrigger() {
        document.getElementById('importFile').click();
    },

    // --- Robust Restore ---

    async restoreData(input) {
        const file = input.files[0];
        if (!file) return;

        const confirmed = await this.showConfirm('Restore Data', 'PERINGATAN: Restore akan MENGHAPUS semua data saat ini. Lanjut?');
        if (!confirmed) {
            input.value = '';
            return;
        }

        this.showProgress(0, 'Menyiapkan Restore...', 'Mengirim data...');
        localStorage.setItem('APP_STATUS', 'RESTORING');

        if (this.worker) {
            this.worker.postMessage({ action: 'restore', payload: file });
        } else {
            // Main thread fallback: Need to read file text first
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    await this.processRestoreMain(json);
                } catch (err) {
                    this.hideProgress();
                    this.showAlert('File Error', 'File corrupt: ' + err.message);
                    localStorage.removeItem('APP_STATUS');
                }
            };
            reader.readAsText(file);
        }

        input.value = '';
    },

    async resumeRestore() {
        const confirmed = await this.showConfirm('Resume Restore', 'Pemberitahuan: Sistem mendeteksi proses restore yang belum selesai. Lanjutkan sekarang?');
        if (!confirmed) {
            localStorage.removeItem('APP_STATUS');
            await this.db.deleteRestorePoint();
            return;
        }

        this.showProgress(0, 'Melanjutkan Restore...', 'Memuat data...');

        if (this.worker) {
            this.worker.postMessage({ action: 'resume' });
        } else {
            // Main thread fallback
            try {
                const json = await this.db.getRestorePoint();
                if (!json) throw new Error('Backup cache missing');
                await this.processRestoreMain(json);
            } catch (e) {
                this.showAlert('Resume Failed', 'Gagal resume: ' + e.message);
            }
        }
    },

    async processRestoreMain(json) {
        try {
            let entriesToRestore = [];
            let imagesToRestore = [];

            // Detect & Normalize Format
            if (Array.isArray(json)) {
                // Legacy Array Format (V1)
                json.forEach(item => {
                    entriesToRestore.push({
                        id: String(item.id || Date.now() + Math.random()),
                        date: String(item.date || new Date().toISOString().slice(0, 10)),
                        title: String(item.title || 'Untitled'),
                        type: String(item.type || 'lainnya'),
                        amount: parseFloat(item.amount) || 0,
                        reason: String(item.reason || ''),
                        highlight: !!item.highlight,
                        pinned: !!item.pinned,
                        timestamp: Number(item.timestamp) || Date.now(),
                        hasImage: !!(item.image || item.hasImage),
                        imageData: (typeof item.image === 'string') ? item.image : null
                    });
                });
            } else if (json.version === 2 && Array.isArray(json.entries)) {
                // Version 2 Format
                entriesToRestore = json.entries.map(item => ({
                    ...item,
                    amount: parseFloat(item.amount) || 0, // IMPORTANT: Default to 0 if missing
                    hasImage: !!item.hasImage,
                    imageData: null // Will be populated from images array if exists
                }));

                // Map separate images back to entries
                if (Array.isArray(json.images)) {
                    json.images.forEach(img => {
                        const target = entriesToRestore.find(e => String(e.id) === String(img.entryId));
                        if (target) {
                            target.imageData = img.data;
                            target.hasImage = true;
                        }
                    });
                }
            } else {
                throw new Error('Format file tidak valid/didukung.');
            }

            // Restore Process (Upload to Cloud)
            const total = entriesToRestore.length;
            this.showProgress(0, 'Membersihkan Cloud...', `Menghapus data lama...`);

            // 1. Wipe Existing Cloud Data (Overwrite Mode)
            await Auth.resetCloud();

            this.showProgress(0, 'Restore ke Cloud...', `Memproses ${total} data...`);

            // 2. Batch Upload (Optimized for Rate Limits & Speed)
            // Cloudflare Worker Rate Limit: 100 req/min/IP.
            // Batching prevents hitting this limit for large datasets.
            const BATCH_SIZE = 20; 

            for (let i = 0; i < total; i += BATCH_SIZE) {
                const chunk = entriesToRestore.slice(i, i + BATCH_SIZE);
                try {
                    // Use syncWithCloud which uses /api/data/sync (Batch Insert)
                    await Auth.syncWithCloud(chunk);
                } catch (e) {
                    console.error(`Batch restore failed at index ${i}`, e);
                    throw new Error(`Gagal upload batch data (Items ${i + 1}-${Math.min(i + BATCH_SIZE, total)}). ${e.message}`);
                }

                // Update Progress UI
                const currentCount = Math.min(i + BATCH_SIZE, total);
                const pct = Math.floor((currentCount / total) * 100);
                this.updateProgressUI(pct, 'restore', `Mengupload ${currentCount}/${total}...`);
            }

            this.handleSuccess('restore');

        } catch (e) {
            console.error(e);
            this.hideProgress();
            this.showAlert('Restore Failed', 'Gagal Restore: ' + e.message);
            localStorage.removeItem('APP_STATUS');
        }
    },

    // --- Reset ---

    // confirmReset is defined later in the file at line ~1038 with proper cloud reset logic

    async migrateFromLocalStorage() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.showProgress(0, 'Migrasi Data Lama', 'Mengupload ke Cloud...');
                    let successCount = 0;

                    for (let i = 0; i < parsed.length; i++) {
                        const entry = parsed[i];
                        try {
                            // Format check
                            const newEntry = {
                                id: String(entry.id || Date.now() + i),
                                date: entry.date,
                                type: entry.type || 'lainnya',
                                amount: parseFloat(entry.amount) || 0,
                                title: entry.title || 'Untitled',
                                reason: entry.reason || '',
                                highlight: !!entry.highlight,
                                pinned: !!entry.pinned,
                                hasImage: !!entry.image,
                                imageData: entry.image || null,
                                timestamp: entry.timestamp || Date.now()
                            };

                            await Auth.saveEntry(newEntry);
                            successCount++;
                            this.updateProgressUI((i / parsed.length) * 100, 'restore', `Migrasi ${i + 1}/${parsed.length}`);
                        } catch (err) {
                            console.error('Migration failed for item', entry, err);
                        }
                    }

                    // Clear old storage after successful migration
                    if (successCount > 0) {
                        localStorage.removeItem(this.STORAGE_KEY);
                        this.data = await Auth.fetchEntries();
                        this.renderList();
                        this.showToast(`✅ Berhasil migrasi ${successCount} catatan ke Cloud!`);
                    }
                }
            } catch (e) {
                console.error('Migration error:', e);
                this.showToast('Gagal migrasi data lama.');
            } finally {
                this.hideProgress();
            }
        }
    },

    registerServiceWorker() {
        if ('serviceWorker' in navigator && location.protocol !== 'file:') {
            // Unregister old scopes to ensure fresh worker logic
            // navigator.serviceWorker.getRegistrations().then(registrations => {
            //    for(let registration of registrations) registration.unregister();
            // });

            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    // console.log('SW Registered');
                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    console.log('New content available; please refresh.');
                                    this.showToast('Update tersedia. Refresh untuk menerapkan.');
                                } else {
                                    console.log('Content is cached for offline use.');
                                }
                            }
                        };
                    };
                })
                .catch(err => console.error('❌ SW registration failed:', err));

            // PWA Install Prompt handled globally at top of file
            // window.addEventListener('beforeinstallprompt', ...)
        }
    },

    // --- Sync Logic ---

    async performSync() {
        if (!Auth.isAuthenticated()) return;

        try {
            this.showToast('🔄 Mengunduh data terbaru...');

            // AUTHORITY: CLOUD IS TRUTH
            // We do not upload "local" changes here because "Online Only" app pushes changes immediately on save.
            // Any "local only" data is considered stale/failed and should be overwritten by Cloud Truth.

            // 1. Fetch All Metadata from Cloud
            const cloudEntries = await Auth.fetchEntries();
            if (!Array.isArray(cloudEntries)) throw new Error('Invalid cloud response');

            // 2. Get All Local IDs to determine what to delete (Zombies)
            // We use getAllEntries just to get IDs, or optimize if DB has getKeys method
            const localEntries = await this.db.getAllEntries();
            const localMap = new Map();
            localEntries.forEach(e => localMap.set(String(e.id), e));

            const cloudMap = new Map();
            cloudEntries.forEach(e => cloudMap.set(String(e.id), e));

            // 3. Diffing
            const toDelete = [];
            const toUpdate = [];

            // A. Identify Zombies (Local items not in Cloud)
            for (const localId of localMap.keys()) {
                if (!cloudMap.has(localId)) {
                    toDelete.push(localId);
                }
            }

            // B. Prepare Updates (Cloud items to Local)
            for (const item of cloudEntries) {
                const entryData = {
                    id: String(item.id),
                    date: item.date,
                    title: item.title,
                    type: item.type,
                    amount: parseFloat(item.amount) || 0,
                    reason: item.reason,
                    highlight: !!item.highlight,
                    pinned: !!item.pinned,
                    hasImage: !!item.hasImage,
                    timestamp: item.timestamp,
                    last_synced: item.last_synced
                };
                toUpdate.push(entryData);
            }

            // 4. Execution
            if (toDelete.length > 0) {
                console.log('Sync: Deleting zombies', toDelete.length);
                // Parallel delete
                await Promise.all(toDelete.map(id => this.db.deleteFull(id)));
            }

            if (toUpdate.length > 0) {
                console.log('Sync: Updating entries', toUpdate.length);
                await this.db.bulkPut('entries', toUpdate);
            }

            // 5. Image State Consistency
            // If cloud says 'hasImage: false', ensure we don't have a lingering image blob
            const imageCleanups = [];
            for (const item of cloudEntries) {
                if (!item.hasImage) {
                    // Start check/delete in background (fire and forget acceptable or await)
                    imageCleanups.push(this.db.deleteImage(String(item.id)));
                }
            }
            if (imageCleanups.length > 0) await Promise.all(imageCleanups);

            // 6. Update Runtime State
            this.data = toUpdate;
            this.renderList();
            this.showToast('✅ Data termutakhir (Cloud Sync)');

        } catch (e) {
            console.error('Sync error:', e);
            if (e.message.includes('401') || e.message.includes('Unauthorized')) {
                // Token expired/invalid, let Auth handle it or just stop
                return;
            }
            this.showToast('⚠️ Gagal sinkronisasi: ' + (e.message || 'Koneksi bermasalah'));
        }
    },

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        this.updateThemeIcon(savedTheme);
    },

    // --- Event Listeners (CSP Compliant) ---
    initEventListeners() {
        // Helper
        const bind = (id, event, handler) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(event, handler);
        };

        // Header Actions
        bind('themeToggle', 'click', () => this.toggleTheme());
        bind('installBtn', 'click', () => this.installApp());
        bind('backupBtn', 'click', () => this.backupData());
        bind('triggerRestoreBtn', 'click', () => this.restoreTrigger());
        bind('importFile', 'change', (e) => this.restoreData(e.target));

        // Filters
        bind('searchInput', 'input', () => this.onSearchInput());
        bind('filterType', 'change', () => this.renderList());
        bind('dateStart', 'change', () => this.renderList());
        bind('dateEnd', 'change', () => this.renderList());
        bind('copyBtn', 'click', () => this.copyText());
        bind('downloadBtn', 'click', () => this.downloadTxt());
        bind('resetFilterBtn', 'click', () => this.resetFilters());

        // FAB
        bind('fabBtn', 'click', () => this.openModal());

        // Modals
        // Entry Modal
        bind('closeEntryModalBtn', 'click', () => this.closeModal());
        bind('cancelEntryModalBtn', 'click', () => this.closeModal());
        bind('entryForm', 'submit', (e) => {
            e.preventDefault();
            this.saveEntry();
        });
        bind('entryImage', 'change', (e) => this.handleImagePreview(e.target));
        bind('triggerImgUploadBtn', 'click', () => document.getElementById('entryImage').click());
        bind('replaceImgBtn', 'click', () => document.getElementById('entryImage').click());
        bind('removeImageBtn', 'click', () => this.clearImage());

        // Drag & Drop Handling (CSP Compliant)
        const dropZone = document.getElementById('imageDropZone');
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = 'var(--primary)';
                dropZone.style.backgroundColor = 'var(--bg-card-hover)';
            });
            dropZone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = 'var(--border-color)';
                dropZone.style.backgroundColor = 'var(--bg-card)';
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.style.borderColor = 'var(--border-color)';
                dropZone.style.backgroundColor = 'var(--bg-card)';

                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const input = document.getElementById('entryImage');
                    input.files = e.dataTransfer.files;
                    this.handleImagePreview(input);
                }
            });
        }

        // Delete Modal
        bind('closeDeleteModalBtn', 'click', () => this.closeDeleteModal());
        bind('cancelDeleteBtn', 'click', () => this.closeDeleteModal());
        bind('confirmDeleteBtn', 'click', () => this.confirmDelete());

        // Reset Modal
        bind('triggerResetBtn', 'click', () => this.initiateReset());
        bind('closeResetModalBtn', 'click', () => this.closeResetModal());
        bind('cancelResetBtn', 'click', () => this.closeResetModal());
        bind('btnConfirmReset', 'click', () => this.confirmReset());

        // Reset Input Validation
        bind('resetConfirmInput', 'input', (e) => { // Changed keyup to input
            const btn = document.getElementById('btnConfirmReset');
            if (e.target.value.toLowerCase() === 'yes') {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.style.boxShadow = 'none';
            }
        });

        // Logout Modal
        bind('closeLogoutModalBtn', 'click', () => this.closeLogoutModal());
        bind('cancelLogoutBtn', 'click', () => this.closeLogoutModal());
        bind('btnConfirmLogout', 'click', () => this.confirmLogout());

        // Global Journal List Delegation (Edit, Highlight, Pin, Delete)
        const list = document.getElementById('journalList');
        if (list) {
            list.addEventListener('click', (e) => {
                // Traverse up to find button
                const btn = e.target.closest('button');
                if (!btn) return;

                const action = btn.dataset.action;
                const id = btn.dataset.id;

                if (!action || !id) return;

                switch (action) {
                    case 'highlight': this.toggleHighlight(id); break;
                    case 'edit': this.editEntry(id); break;
                    case 'pin': this.togglePin(id); break;
                    case 'delete': this.initiateDelete(id); break;
                }
            });
        }

        // Close Modals on Outside Click
        window.onclick = (event) => {
            const entryModal = document.getElementById('entryModal');
            const deleteModal = document.getElementById('deleteModal');
            const resetModal = document.getElementById('resetModal');
            const logoutModal = document.getElementById('logoutModal');
            if (event.target == entryModal) this.closeModal();
            if (event.target == deleteModal) this.closeDeleteModal();
            if (event.target == resetModal) this.closeResetModal();
            if (event.target == logoutModal) this.closeLogoutModal();
        };
    },

    // --- Logic ---

    debounceTimer: null,
    deferredPrompt: null,

    async logStorageStats() {
        // Placeholder
    },

    onSearchInput() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.renderList();
        }, 300);
    },

    async installApp() {
        // iOS Handling
        // Detect either standard iOS or iPadOS (often reports as Macintosh with maxTouchPoints > 1)
        const isIOS = (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document)) && !window.MSStream;

        if (isIOS) {
            alert('Untuk menginstall di iOS:\n1. Tap tombol Share (ikon kotak dengan panah ke atas)\n2. Pilih "Add to Home Screen"');
            return;
        }

        const promptEvent = deferredInstallPrompt || this.deferredPrompt;
        if (!promptEvent) {
            console.log('No install prompt available');
            // Optionally show check for existing installation instructions
            return;
        }

        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
            deferredInstallPrompt = null;
            this.deferredPrompt = null;
            document.getElementById('installBtn').style.display = 'none';
        }
    },

    // --- Image Handling ---

    processImage(file) {
        return new Promise((resolve, reject) => {
            if (file.size > 10 * 1024 * 1024) {
                reject(new Error('Ukuran file terlalu besar (>10MB).'));
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_DIM = 600;

                    if (width > height) {
                        if (width > MAX_DIM) {
                            height *= MAX_DIM / width;
                            width = MAX_DIM;
                        }
                    } else {
                        if (height > MAX_DIM) {
                            width *= MAX_DIM / height;
                            height = MAX_DIM;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                    resolve(dataUrl);
                };
                img.onerror = () => reject(new Error('Format gambar tidak didukung.'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Gagal membaca file.'));
            reader.readAsDataURL(file);
        });
    },

    handleImagePreview(input) {
        // Fix: Handle case when user cancels file picker (files length 0)
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        if (file) {
            document.getElementById('imageFileName').innerText = file.name;
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.getElementById('imagePreview');
                img.src = e.target.result;
                document.getElementById('uploadPlaceholder').style.display = 'none';
                document.getElementById('previewContainer').style.display = 'block';
            }
            reader.readAsDataURL(file);
        }
    },

    clearImage() {
        document.getElementById('entryImage').value = '';
        document.getElementById('imageFileName').innerText = '';
        const img = document.getElementById('imagePreview');
        img.src = '';

        document.getElementById('uploadPlaceholder').style.display = 'block';
        document.getElementById('previewContainer').style.display = 'none';
        this.pendingImageClear = true;
    },

    // --- CRUD ---

    async saveEntry() {
        const id = document.getElementById('entryId').value;
        const date = document.getElementById('entryDate').value;
        const type = document.getElementById('entryType').value;
        const amount = 0; // Removed from UI, defaulted to 0
        const title = document.getElementById('entryTitle').value;
        const reason = document.getElementById('entryReason').value;
        const highlight = document.getElementById('entryHighlight').checked;
        const pinned = document.getElementById('entryPin').checked;
        const fileInput = document.getElementById('entryImage');

        let imageData = null;
        let hasImage = false;

        if (!date || !title) {
            this.showToast('Mohon isi Tanggal dan Judul');
            return;
        }

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            try {
                this.showToast('Mengoptimalkan gambar...');
                imageData = await this.processImage(file);
                hasImage = true;
            } catch (e) {
                console.error(e);
                this.showToast('Gagal memproses gambar: ' + e.message);
                return;
            }
        } else if (id && !this.pendingImageClear) {
            const existing = this.data.find(i => String(i.id) === String(id));
            if (existing && existing.hasImage) {
                hasImage = true;
            }
        }

        const entry = {
            id: id || Date.now().toString(),
            date,
            type,
            amount,
            title,
            reason,
            highlight,
            pinned,
            hasImage,
            timestamp: id ? (this.data.find(i => i.id === id)?.timestamp || Date.now()) : Date.now()
        };

        try {
            // Full Cloud Save
            // Include imageData directly in the payload
            const payload = { ...entry, imageData };

            await Auth.saveEntry(payload);

            if (id) {
                const index = this.data.findIndex(item => String(item.id) === String(id));
                if (index > -1) {
                    this.data[index] = { ...this.data[index], ...entry }; // Update local state for immediate UI
                    // If image changed, we might need to update the UI specifically or reload
                    if (hasImage) this.data[index].hasImage = true;
                }
                this.showToast('✅ Catatan diperbarui (Cloud)');
            } else {
                this.data.unshift(entry);
                this.showToast('✅ Catatan ditambahkan (Cloud)');
            }

            this.pendingImageClear = false;
            this.renderList();
            this.closeModal();

        } catch (error) {
            console.error('Save entry error:', error);
            this.showToast('❌ Error menyimpan ke Cloud: ' + error.message);
        }
    },

    // --- Modals & Actions ---

    initiateDelete(id) {
        this.deleteTargetId = id;
        document.getElementById('deleteModal').classList.add('open');
    },

    closeDeleteModal() {
        document.getElementById('deleteModal').classList.remove('open');
        this.deleteTargetId = null;
    },

    async confirmDelete() {
        if (this.deleteTargetId) {
            try {
                await Auth.deleteEntry(this.deleteTargetId);
                this.data = this.data.filter(item => String(item.id) !== String(this.deleteTargetId));
                this.showToast('✅ Catatan dihapus (Cloud)');
                this.renderList();
            } catch (error) {
                console.error('Delete error:', error);
                this.showToast('❌ Gagal menghapus: ' + error.message);
            }
        }
        this.closeDeleteModal();
    },

    initiateReset() {
        const modal = document.getElementById('resetModal');
        const input = document.getElementById('resetConfirmInput');
        const btn = document.getElementById('btnConfirmReset');

        input.value = '';
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.style.boxShadow = 'none';

        setTimeout(() => input.focus(), 100);
        modal.classList.add('open');
    },

    closeResetModal() {
        document.getElementById('resetModal').classList.remove('open');
    },

    async confirmReset() {
        const input = document.getElementById('resetConfirmInput');
        if (input.value.toLowerCase() !== 'yes') return;

        try {
            this.showProgress(0, 'Menghapus Data', 'Membersihkan Cloud...');

            await Auth.resetCloud();

            this.data = [];
            localStorage.removeItem(this.STORAGE_KEY);

            this.showToast('✅ Semua data (HP & Cloud) berhasil dihapus');
            this.renderList();
            this.closeResetModal();
        } catch (e) {
            console.error('Reset error:', e);
            this.showToast('❌ Gagal reset: ' + e.message);
        } finally {
            this.hideProgress();
        }
    },

    // --- Logout Logic ---

    initiateLogout() {
        document.getElementById('logoutModal').classList.add('open');
    },

    closeLogoutModal() {
        document.getElementById('logoutModal').classList.remove('open');
    },

    confirmLogout() {
        try {
            Auth.logout();
            window.location.replace('login.html');
        } catch (e) {
            console.error('Logout error:', e);
            localStorage.clear();
            window.location.replace('login.html');
        }
    },

    editEntry(id) {
        const item = this.data.find(i => String(i.id) === String(id));
        if (!item) return;

        document.getElementById('entryId').value = item.id;
        document.getElementById('entryDate').value = item.date;
        document.getElementById('entryType').value = item.type;
        // document.getElementById('entryAmount').value = item.amount || ''; // Removed from UI
        document.getElementById('entryTitle').value = item.title;
        document.getElementById('entryReason').value = item.reason || '';
        document.getElementById('entryHighlight').checked = !!item.highlight;
        document.getElementById('entryPin').checked = !!item.pinned;

        if (item.hasImage) {
            Auth.fetchImage(item.id).then(imageData => {
                if (imageData) {
                    const img = document.getElementById('imagePreview');
                    img.src = imageData;
                    document.getElementById('uploadPlaceholder').style.display = 'none';
                    document.getElementById('previewContainer').style.display = 'block';
                }
            }).catch(err => {
                this.clearImage();
            });
        } else {
            this.clearImage();
        }
        this.pendingImageClear = false;
        document.getElementById('modalTitle').innerText = 'Edit Catatan';
        this.openModal(true);
    },

    async toggleHighlight(id) {
        const entry = this.data.find(i => String(i.id) === String(id));
        if (!entry) return;
        try {
            entry.highlight = !entry.highlight;
            // Optimistic update
            this.renderList();
            await Auth.saveEntry(entry);
        } catch (e) {
            console.error('Highlight error', e);
            entry.highlight = !entry.highlight; // Revert
            this.renderList();
            this.showToast('Gagal update highlight');
        }
    },

    async togglePin(id) {
        const entry = this.data.find(i => String(i.id) === String(id));
        if (!entry) return;
        try {
            entry.pinned = !entry.pinned;
            // Optimistic update
            this.renderList();
            await Auth.saveEntry(entry);
        } catch (e) {
            console.error('Pin error', e);
            entry.pinned = !entry.pinned; // Revert
            this.renderList();
            this.showToast('Gagal update pin');
        }
    },

    // --- Rendering ---

    async renderList() {
        if (!Array.isArray(this.data)) {
            this.data = [];
        }

        const listContainer = document.getElementById('journalList');
        const filtered = this.getFilteredData();
        const totalNotes = filtered.length;
        const totalImages = filtered.filter(i => i.hasImage).length;
        const statsEl = document.getElementById('statsBar');
        // Storage stats irrelevant for Cloud
        const storageStats = null;

        if (statsEl) {
            let storageHTML = '';
            if (storageStats) {
                const color = storageStats.percentUsed > 80 ? '#ef4444' :
                    storageStats.percentUsed > 50 ? '#f59e0b' : '#10b981';

                // Note: Using data-action for reset button for Delegation
                storageHTML = `
                    <div class="stat-item">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        </svg>
                        <span>Storage:</span>
                        <span class="stat-value" style="color: ${color}">${storageStats.usageInMB} MB / ${storageStats.quotaInGB} GB</span>
                        <button data-action="reset-storage" title="Reset Storage" style="margin-left:8px; border:1px solid #ef4444; color:#ef4444; background:transparent; border-radius:4px; padding:2px 8px; font-size:0.7rem; cursor:pointer;" type="button">RESET</button>
                    </div>
                `;
            }

            statsEl.innerHTML = `
                <div class="stat-item">
                     <span>Catatan:</span> <span class="stat-value">${totalNotes}</span>
                </div>
                <div class="stat-item">
                     <span>Gambar:</span> <span class="stat-value">${totalImages}</span>
                </div>
                ${storageHTML}
            `;
        }

        listContainer.innerHTML = '';

        if (filtered.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <p>Tidak ada catatan.</p>
                    <button class="btn btn-secondary" id="emptyStateResetBtn">Reset Filter</button>
                </div>
            `;
            // Bind the dynamic button
            const btn = document.getElementById('emptyStateResetBtn');
            if (btn) btn.addEventListener('click', () => this.resetFilters());
            return;
        }

        const fragment = document.createDocumentFragment();

        filtered.forEach(item => {
            const card = document.createElement('div');
            const rawId = String(item.id);
            const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
            const titleSafe = this.escapeHtml(item.title);
            const reasonSafe = this.escapeHtml(item.reason);
            const typeSafe = this.escapeHtml(item.type);

            card.className = `journal-card ${item.highlight ? 'highlighted' : ''}`;

            // Using data attributes for Event Delegation: data-action, data-id
            card.innerHTML = `
                 <div class="card-header">
                     <div class="card-title-group">
                          <span class="card-date">${this.formatDate(item.date)}</span>
                          <h3 class="card-title">${titleSafe}</h3>
                          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <span class="card-badge badge-${typeSafe}">${typeSafe}</span>
                            ${item.amount ? `<span class="card-badge" style="background:var(--bg-glass);color:var(--text-main);border:1px solid var(--border-color);">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(item.amount)}</span>` : ''}
                          </div>
                      </div>
                     <div class="card-actions">
                         <button class="btn-icon action-star ${item.highlight ? 'active' : ''}" data-action="highlight" data-id="${cleanId}" aria-label="Highlight">
                             <svg pointer-events="none" viewBox="0 0 24 24" fill="${item.highlight ? 'currentColor' : 'none'}" stroke="${item.highlight ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                         </button>
                         <button class="btn-icon action-edit" data-action="edit" data-id="${cleanId}" aria-label="Edit">
                             <svg pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                         </button>
                         <button class="btn-icon action-pin ${item.pinned ? 'active' : ''}" data-action="pin" data-id="${cleanId}" aria-label="Pin">
                              <svg pointer-events="none" viewBox="0 0 24 24" fill="${item.pinned ? 'currentColor' : 'none'}" stroke="${item.pinned ? 'none' : 'currentColor'}" stroke-width="2" style="width:18px;height:18px;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                         </button>
                         <button class="btn-icon action-delete" data-action="delete" data-id="${cleanId}" aria-label="Hapus">
                             <svg pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
                         </button>
                     </div>
                 </div>
                 <div class="reason-box">
                     <div class="card-content">${reasonSafe || '-'}</div>
                     ${item.hasImage ? `
                         <div class="image-container" data-entry-id="${cleanId}" style="margin-top:12px;">
                             <div class="image-skeleton" style="width:100%; height:200px; border-radius:8px;"></div>
                         </div>
                     ` : ''}
                 </div>
            `;
            fragment.appendChild(card);
        });

        listContainer.appendChild(fragment);
        setTimeout(() => this.loadImagesLazy(), 100);
    },

    async loadImagesLazy() {
        const containers = document.querySelectorAll('.image-container');
        for (const container of containers) {
            const entryId = container.dataset.entryId;
            if (!entryId) continue;

            try {
                // Fetch from Cloud API
                const imageData = await Auth.fetchImage(entryId);

                if (imageData) {
                    container.innerHTML = `<img src="${imageData}" style="width:100%; border-radius:8px; display:block; box-shadow: var(--shadow-sm);" loading="lazy" alt="Attachment">`;

                    // Simple modal for image view
                    const img = container.querySelector('img');
                    img.style.cursor = 'zoom-in';
                    img.onclick = () => {
                        const modal = document.createElement('div');
                        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:fadeIn 0.2s;';
                        modal.innerHTML = `<img src="${imageData}" style="max-width:95%;max-height:95vh;border-radius:4px;box-shadow:0 0 30px rgba(0,0,0,0.5);">`;
                        modal.onclick = () => modal.remove();
                        document.body.appendChild(modal);
                    };

                } else {
                    container.style.display = 'none';
                }
            } catch (e) {
                console.error('Error loading image', entryId, e);
                container.style.display = 'none';
            }
        }
    },


    // --- Helpers ---

    getFilteredData() {
        let filtered = [...this.data]; // Copy for sorting
        const search = document.getElementById('searchInput').value.toLowerCase();
        const type = document.getElementById('filterType').value;
        const start = document.getElementById('dateStart').value;
        const end = document.getElementById('dateEnd').value;

        if (search) {
            filtered = filtered.filter(item =>
                item.title.toLowerCase().includes(search) ||
                (item.reason && item.reason.toLowerCase().includes(search))
            );
        }

        if (type) {
            filtered = filtered.filter(item => item.type === type);
        }

        if (start) {
            filtered = filtered.filter(item => item.date >= start);
        }

        if (end) {
            filtered = filtered.filter(item => item.date <= end);
        }

        // Sort: Pinned First > Date Descending > Created Descending
        filtered.sort((a, b) => {
            // Helper to handle legacy data types (e.g. "false" string)
            const isPinned = (val) => {
                if (val === 'false') return false;
                return !!val;
            };

            const pinA = isPinned(a.pinned);
            const pinB = isPinned(b.pinned);

            if (pinA !== pinB) {
                return pinA ? -1 : 1;
            }
            if (a.date !== b.date) {
                // Safely compare dates
                const dateA = a.date || '';
                const dateB = b.date || '';
                return dateB.localeCompare(dateA);
            }
            return (b.timestamp || 0) - (a.timestamp || 0);
        });

        return filtered;
    },

    toggleTheme() {
        const body = document.body;
        const current = body.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        body.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        this.updateThemeIcon(next);
    },

    updateThemeIcon(theme) {
        const btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    },

    openModal(isEdit = false) {
        if (!isEdit) {
            document.getElementById('entryForm').reset();
            document.getElementById('entryId').value = '';
            document.getElementById('entryDate').value = new Date().toISOString().slice(0, 10);
            // document.getElementById('entryAmount').value = ''; // Removed from UI
            document.getElementById('modalTitle').innerText = 'Tambah Catatan';
            this.clearImage();
        }
        document.getElementById('entryModal').classList.add('open');
    },

    closeModal() {
        document.getElementById('entryModal').classList.remove('open');
    },

    showToast(msg) {
        const t = document.getElementById('toast');
        t.innerText = msg;
        t.className = 'toast show';
        setTimeout(() => t.className = 'toast', 3000);
    },

    // --- GENERIC MODALS ---
    showAlert(title, message) {
        return new Promise((resolve) => {
            const el = document.getElementById('alertModal');
            document.getElementById('alertTitle').innerText = title;
            document.getElementById('alertMessage').innerText = message;

            const btn = document.getElementById('alertOkBtn');
            const handler = () => {
                el.classList.remove('open');
                btn.removeEventListener('click', handler);
                resolve();
            };
            btn.addEventListener('click', handler);
            el.classList.add('open');
        });
    },

    showConfirm(title, message) {
        return new Promise((resolve) => {
            const el = document.getElementById('genericConfirmModal');
            document.getElementById('gConfirmTitle').innerText = title;
            document.getElementById('gConfirmMessage').innerText = message;

            const yesBtn = document.getElementById('gConfirmYesBtn');
            const noBtn = document.getElementById('gConfirmCancelBtn');
            const overlay = el; // Clicking outside? optional logic

            const cleanup = () => {
                el.classList.remove('open');
                yesBtn.removeEventListener('click', onYes);
                noBtn.removeEventListener('click', onNo);
            };

            const onYes = () => { cleanup(); resolve(true); };
            const onNo = () => { cleanup(); resolve(false); };

            yesBtn.addEventListener('click', onYes);
            noBtn.addEventListener('click', onNo);
            el.classList.add('open');
        });
    },

    async copyText() {
        // Use filtered data so user can copy specific views (e.g. per month)
        const dataToExport = this.getFilteredData();
        if (!dataToExport || dataToExport.length === 0) {
            this.showToast('⚠️ Tidak ada data untuk disalin');
            return;
        }

        // Format: WhatsApp Friendly
        const lines = dataToExport.map((i, index) => {
            const date = this.formatDate(i.date);
            const type = i.type.toUpperCase();
            const reason = i.reason ? i.reason.replace(/\n/g, ' ') : '-';

            return `*${index + 1}. ${i.title}*\n📅 ${date} • ${type}\n📝 ${reason}`;
        });

        const header = `📋 *LAPORAN JURNAL KEUANGAN*\nTotal: ${dataToExport.length} Catatan\nGenerated: ${new Date().toLocaleString('id-ID')}\n\n`;
        const txt = header + lines.join('\n\n-------------------\n\n');

        try {
            await navigator.clipboard.writeText(txt);
            this.showToast('✅ Laporan disalin ke clipboard');

            // Mobile Detection & Redirect
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

            if (isMobile) {
                this.showToast('🚀 Mengalihkan ke WhatsApp...');
                setTimeout(() => {
                    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
                }, 800);
            }

        } catch (err) {
            console.error('Copy failed:', err);
            this.showToast('❌ Gagal menyalin: ' + err.message);
        }
    },

    downloadTxt() {
        const txt = this.data.map(i => `${i.date} [${i.type}]: ${i.title}\nKet: ${i.reason}\n----------------`).join('\n');
        const blob = new Blob([txt], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'jurnal.txt';
        a.click();
    },

    formatDate(d) {
        if (!d) return '-';
        const date = new Date(d);
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.innerText = str;
        return div.innerHTML;
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});

