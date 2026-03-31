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
    isSyncing: false,
    isSaving: false, // Guard against double-submit / rapid clicks


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

            // --- Cloud Init (with Connection Guard) ---
            this.showProgress(10, 'Memuat Data', 'Menghubungkan ke server...');

            try {
                // Check connection first via ConnectionMonitor
                if (typeof ConnectionMonitor !== 'undefined') {
                    const isConnected = await ConnectionMonitor.checkAPIConnection(true);
                    if (!isConnected) {
                        console.warn('⚠️ No API connection, showing banner...');
                        ConnectionMonitor.showBanner('offline');
                    }
                }

                // Try Cloud First (Authority)
                this.data = await Auth.fetchEntries();
                // Update Local Cache immediately
                await this.db.clearAll();
                await this.db.bulkPut('entries', this.data);
                console.log('✅ Cloud Data Loaded & Cached');

                // Hide connection banner if shown
                if (typeof ConnectionMonitor !== 'undefined') {
                    ConnectionMonitor.hideBanner();
                }
            } catch (e) {
                console.warn('⚠️ Cloud fetch failed, showing connection status...', e);

                // Show appropriate connection banner
                if (typeof ConnectionMonitor !== 'undefined') {
                    if (!navigator.onLine) {
                        ConnectionMonitor.showBanner('offline');
                    } else {
                        ConnectionMonitor.showBanner('error');
                    }
                }

                // Fallback to Local DB (READ-ONLY MODE)
                try {
                    const localData = await this.db.getAllEntries();
                    if (localData && localData.length > 0) {
                        this.data = localData;
                        // Don't show toast - connection banner is more prominent
                    } else {
                        // No local cache
                        this.data = [];
                        this.showConnectionRequiredAlert();
                    }
                } catch (dbErr) {
                    console.error('Critical Init Error:', dbErr);
                    this.data = [];
                    this.showConnectionRequiredAlert();
                }
            } finally {
                this.hideProgress();
            }

            this.registerServiceWorker();
            this.initPreferences();
            this.initEventListeners();
            this.renderList();

            // Background Sync (Every 10 seconds) - Near Real-time
            this.syncIntervalId = setInterval(() => this.performSync(), 10000);

            // REAL-TIME: Instant sync when user returns to tab (cross-device scenario)
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && Auth.isAuthenticated()) {
                    // Small delay to let network stabilize after screen wake
                    setTimeout(() => this.performSync(), 500);
                }
            });

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
                userDiv.style.cssText = 'position: absolute; top: 12px; right: 12px; font-size: 0.85rem; color: var(--text-muted); background: var(--bg-card); padding: 4px 12px; border-radius: 20px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 8px; z-index: 50; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); max-width: calc(100vw - 24px);';
                userDiv.innerHTML = `
                        <div style="width: 8px; height: 8px; background: #10b981; border-radius: 50%;"></div>
                        <span style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(user.username || user.email)}</span>
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
        await this.waitForSync('Backup');
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
            this.updateProgressUI(80, 'backup', 'fetching_preferences');
            await new Promise(r => setTimeout(r, 50));

            // ALWAYS construct preferences from active local state to guarantee we capture what the user sees
            const preferences = {
                theme: document.body.getAttribute('data-theme') || 'light',
                excludedExports: Array.from(this.excludedExportIds || []),
                excludedTxts: Array.from(this.excludedTxtIds || [])
            };

            this.updateProgressUI(90, 'backup', 'compressing');
            await new Promise(r => setTimeout(r, 50));

            const backupData = {
                version: 2,
                timestamp: new Date().toISOString(),
                entries,
                images,
                preferences
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

        await this.waitForSync('Restore');

        this.showProgress(0, 'Menyiapkan Restore...', 'Mengirim data...');
        localStorage.setItem('APP_STATUS', 'RESTORING');

        // ⚠️ FORCE MAIN THREAD RESTORE for Cloud Sync Correctness
        // We bypass the worker here because the worker-side restore only updates the local DB
        // and misses the critical step of wiping/uploading to the Cloud, which processRestoreMain handles.

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                // processRestoreMain handles Cloud Wipe & Upload
                await this.processRestoreMain(json);
            } catch (err) {
                this.hideProgress();
                this.showAlert('File Error', 'File corrupt: ' + err.message);
                localStorage.removeItem('APP_STATUS');
            }
        };
        reader.readAsText(file);

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
                        id: String(item.id || crypto.randomUUID()),
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

            // --- ID REGENERATION (CRITICAL FOR IMPORT/RESTORE) ---
            // Prevent ID collisions and allow cross-account imports
            // Note: Images are already merged into entriesToRestore.imageData at this point
            // so we only need to regenerate the entry IDs
            const idMapping = {};
            entriesToRestore.forEach(entry => {
                const newId = crypto.randomUUID();
                if (entry.id) idMapping[String(entry.id)] = newId;
                entry.id = newId;
            });

            // -----------------------------------------------------

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

            // 3. Restore Preferences (If Version 2+)
            if (json.version === 2 && json.preferences) {
                this.updateProgressUI(100, 'restore', 'Menyimpan Pengaturan...');
                try {
                    // Update excluded IDs based on ID regeneration mapping
                    if (Array.isArray(json.preferences.excludedExports)) {
                        json.preferences.excludedExports = json.preferences.excludedExports.map(oldId => idMapping[String(oldId)]).filter(Boolean);
                    }
                    if (Array.isArray(json.preferences.excludedTxts)) {
                        json.preferences.excludedTxts = json.preferences.excludedTxts.map(oldId => idMapping[String(oldId)]).filter(Boolean);
                    }

                    await Auth.updatePreferences(json.preferences);
                    this.initPreferences(); // Reload preferences in UI
                } catch (e) {
                    console.warn('Gagal memulihkan pengaturan', e);
                }
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
                                id: String(entry.id || crypto.randomUUID()),
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
                            console.error('Migration failed for item ID:', entry.id, err.message);
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
                console.error('Migration error:', e.message);
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

    async waitForSync(operation = 'Proses') {
        if (this.isSyncing) {
            this.showProgress(0, 'Menunggu Sinkronisasi', `Menyelesaikan background sync sebelum ${operation}...`);
            while (this.isSyncing) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
    },

    async performSync() {
        if (this.isSyncing) return;
        if (this.isSaving) return; // Don't sync while a save operation is in progress
        if (!Auth.isAuthenticated()) return;

        this.isSyncing = true;

        try {
            // Silent sync - no toast spam (only show toast on actual data changes)

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

            // Note: bulkPut is deferred until after change detection to avoid
            // unnecessary IndexedDB writes when data hasn't changed.

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

            // 6. Update Runtime State — ONLY re-render if data actually changed
            // This prevents UI flickering/blinking on every sync cycle when nothing changed
            const hasDeleted = toDelete.length > 0;
            const countChanged = toUpdate.length !== this.data.length;

            // Deep content check: compare a fingerprint of key fields
            let contentChanged = false;
            if (!countChanged && !hasDeleted) {
                // Build fast fingerprint from cloud data to compare with current runtime
                const cloudFingerprint = cloudEntries.map(e =>
                    `${e.id}|${e.title}|${e.date}|${e.type}|${e.reason || ''}|${!!e.highlight}|${!!e.pinned}|${!!e.hasImage}|${e.timestamp || 0}`
                ).sort().join(';;');

                const localFingerprint = this.data.map(e =>
                    `${e.id}|${e.title}|${e.date}|${e.type}|${e.reason || ''}|${!!e.highlight}|${!!e.pinned}|${!!e.hasImage}|${e.timestamp || 0}`
                ).sort().join(';;');

                contentChanged = cloudFingerprint !== localFingerprint;
            }

            const dataActuallyChanged = hasDeleted || countChanged || contentChanged;

            if (dataActuallyChanged) {
                this.data = toUpdate;
                // Write to IndexedDB only when data changed
                if (toUpdate.length > 0) {
                    await this.db.bulkPut('entries', toUpdate);
                }
                this.renderList();
                this.showToast('✅ Data termutakhir (Cloud Sync)');
            } else {
                // Silently update runtime reference without re-rendering DOM
                this.data = toUpdate;
            }

            // 7. REAL-TIME PREFERENCE SYNC
            // Fetch latest preferences from cloud (handles cross-device changes)
            try {
                const freshPrefs = await Auth.fetchPreferences();
                if (freshPrefs) {
                    this.applyCloudPreferences(freshPrefs);
                }
            } catch (prefErr) {
                console.warn('Preference sync skipped:', prefErr);
            }

        } catch (e) {
            console.error('Sync error:', e);
            if (e.message.includes('401') || e.message.includes('Unauthorized')) {
                // Token expired/invalid, let Auth handle it or just stop
                return;
            }
            this.showToast('⚠️ Gagal sinkronisasi: ' + (e.message || 'Koneksi bermasalah'));
        } finally {
            this.isSyncing = false;
        }
    },

    initPreferences() {
        let savedTheme = localStorage.getItem('theme');
        const user = Auth.getUser();

        // 1. Theme Init (localStorage for instant paint, cloud for truth)
        if (user && user.preferences && user.preferences.theme) {
            savedTheme = user.preferences.theme;
            localStorage.setItem('theme', savedTheme);
        }
        savedTheme = savedTheme || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        if (document.getElementById('themeToggle')) {
            this.updateThemeIcon(savedTheme);
        }

        // 2. Load Excluded Exports (from cloud user cache ONLY - no separate localStorage)
        this.excludedExportIds = new Set();
        if (user && user.preferences && Array.isArray(user.preferences.excludedExports)) {
            this.excludedExportIds = new Set(user.preferences.excludedExports);
        }

        // 3. Load Excluded Txts (from cloud user cache ONLY - no separate localStorage)
        this.excludedTxtIds = new Set();
        if (user && user.preferences && Array.isArray(user.preferences.excludedTxts)) {
            this.excludedTxtIds = new Set(user.preferences.excludedTxts);
        }

        // 4. BACKGROUND: Fetch FRESH preferences from cloud (non-blocking)
        // This ensures that even if cached user is stale, we get latest within seconds
        if (Auth.isAuthenticated()) {
            setTimeout(() => {
                Auth.fetchPreferences().then(freshPrefs => {
                    if (freshPrefs) {
                        this.applyCloudPreferences(freshPrefs);
                    }
                }).catch(() => { /* Non-fatal */ });
            }, 2000); // 2s delay to not compete with initial data load
        }
    },

    /**
     * APPLY CLOUD PREFERENCES (Real-time Sync)
     * Called by performSync() to apply fresh preferences from the cloud.
     * This ensures cross-device preference changes are reflected immediately.
     */
    applyCloudPreferences(prefs) {
        if (!prefs) return;

        let changed = false;

        // 1. Theme
        if (prefs.theme) {
            const currentTheme = document.body.getAttribute('data-theme');
            if (currentTheme !== prefs.theme) {
                document.body.setAttribute('data-theme', prefs.theme);
                localStorage.setItem('theme', prefs.theme);
                this.updateThemeIcon(prefs.theme);
                changed = true;
            }
        }

        // 2. Excluded Exports
        if (Array.isArray(prefs.excludedExports)) {
            const newSet = new Set(prefs.excludedExports);
            const currentArr = [...this.excludedExportIds].sort().join(',');
            const newArr = [...newSet].sort().join(',');
            if (currentArr !== newArr) {
                this.excludedExportIds = newSet;
                changed = true;
            }
        }

        // 3. Excluded Txts
        if (Array.isArray(prefs.excludedTxts)) {
            const newSet = new Set(prefs.excludedTxts);
            const currentArr = [...this.excludedTxtIds].sort().join(',');
            const newArr = [...newSet].sort().join(',');
            if (currentArr !== newArr) {
                this.excludedTxtIds = newSet;
                changed = true;
            }
        }

        // Re-render if preferences changed (to update button states)
        if (changed) {
            this.renderList();
            console.log('🔄 Preferences synced from cloud');
        }
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
                    case 'toggle-export': this.toggleExportSelection(id); break;
                    case 'toggle-txt': this.toggleTxtSelection(id); break;
                }
            });
        }

        // Close Modals on Outside Click
        window.addEventListener('click', (event) => {
            const entryModal = document.getElementById('entryModal');
            const deleteModal = document.getElementById('deleteModal');
            const resetModal = document.getElementById('resetModal');
            const logoutModal = document.getElementById('logoutModal');
            if (event.target === entryModal) this.closeModal();
            if (event.target === deleteModal) this.closeDeleteModal();
            if (event.target === resetModal) this.closeResetModal();
            if (event.target === logoutModal) this.closeLogoutModal();
        });

        // Keyboard: Escape to close modals (Accessibility)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const alertModal = document.getElementById('alertModal');
                const confirmModal = document.getElementById('genericConfirmModal');
                const entryModal = document.getElementById('entryModal');
                const deleteModal = document.getElementById('deleteModal');
                const resetModal = document.getElementById('resetModal');
                const logoutModal = document.getElementById('logoutModal');

                if (alertModal && alertModal.classList.contains('open')) {
                    document.getElementById('alertOkBtn').click();
                } else if (confirmModal && confirmModal.classList.contains('open')) {
                    document.getElementById('gConfirmCancelBtn').click();
                } else if (deleteModal && deleteModal.classList.contains('open')) {
                    this.closeDeleteModal();
                } else if (resetModal && resetModal.classList.contains('open')) {
                    this.closeResetModal();
                } else if (logoutModal && logoutModal.classList.contains('open')) {
                    this.closeLogoutModal();
                } else if (entryModal && entryModal.classList.contains('open')) {
                    this.closeModal();
                }
            }
        });
    },

    // --- Logic ---

    debounceTimer: null,
    deferredPrompt: null,
    excludedExportIds: new Set(),
    excludedTxtIds: new Set(),

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
        // ⚠️ GUARD 1: Flag-based guard against concurrent calls
        if (this.isSaving) {
            console.warn('Save already in progress, ignoring duplicate call');
            return;
        }

        // ⚠️ GUARD 2: Immediately disable submit button to prevent any click-through
        const submitBtn = document.querySelector('#entryForm button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.opacity = '0.6';
            submitBtn.style.pointerEvents = 'none';
        }

        // ⚠️ CONNECTION CHECK - Prevent data loss
        if (!this.canPerformWriteOperation()) {
            this.showAlert(
                '⚠️ Tidak Dapat Menyimpan',
                'Koneksi internet diperlukan untuk menyimpan data. ' +
                'Data Anda TIDAK akan hilang - tunggu koneksi pulih lalu coba lagi.'
            );
            this._resetSaveButton(submitBtn);
            return;
        }

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
            this._resetSaveButton(submitBtn);
            return;
        }

        // Set saving flag AFTER validation passes
        this.isSaving = true;

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            try {
                this.showToast('Mengoptimalkan gambar...');
                imageData = await this.processImage(file);
                hasImage = true;
            } catch (e) {
                console.error(e);
                this.showToast('Gagal memproses gambar: ' + e.message);
                this.isSaving = false;
                this._resetSaveButton(submitBtn);
                return;
            }
        } else if (id && !this.pendingImageClear) {
            const existing = this.data.find(i => String(i.id) === String(id));
            if (existing && existing.hasImage) {
                hasImage = true;
            }
        }

        // BUG FIX: Use crypto.randomUUID() instead of Date.now() to prevent ID collisions
        const entry = {
            id: id || crypto.randomUUID(),
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
            const payload = { ...entry };

            if (imageData) {
                payload.imageData = imageData;
            } else if (this.pendingImageClear) {
                payload.imageData = null;
            }

            // Save to Cloud (source of truth)
            await Auth.saveEntry(payload);

            // BUG FIX: Instead of manually pushing to this.data (which causes desync),
            // fetch fresh data from cloud to guarantee consistency.
            // This eliminates ALL possible duplication scenarios.
            try {
                const freshData = await Auth.fetchEntries();
                if (Array.isArray(freshData)) {
                    this.data = freshData;
                    // Also update local cache
                    await this.db.bulkPut('entries', this.data);
                }
            } catch (fetchErr) {
                // If fresh fetch fails, do optimistic update as fallback
                console.warn('Post-save sync failed, using optimistic update:', fetchErr);
                if (id) {
                    const index = this.data.findIndex(item => String(item.id) === String(id));
                    if (index > -1) {
                        this.data[index] = { ...this.data[index], ...entry };
                        if (hasImage) this.data[index].hasImage = true;
                    }
                } else {
                    const alreadyExists = this.data.some(item => String(item.id) === String(entry.id));
                    if (!alreadyExists) {
                        this.data.unshift(entry);
                    }
                }
            }

            this.pendingImageClear = false;
            this.showToast(id ? '✅ Catatan diperbarui (Cloud)' : '✅ Catatan ditambahkan (Cloud)');
            this.renderList();
            this.closeModal();

        } catch (error) {
            console.error('Save entry error:', error);
            this.showToast('❌ Error menyimpan ke Cloud: ' + error.message);
        } finally {
            this.isSaving = false;
            this._resetSaveButton(submitBtn);
        }
    },

    // Helper to reset save button state
    _resetSaveButton(btn) {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
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
            // ⚠️ CONNECTION CHECK - Prevent desync
            if (!this.canPerformWriteOperation()) {
                this.showAlert(
                    '⚠️ Tidak Dapat Menghapus',
                    'Koneksi internet diperlukan untuk menghapus data. ' +
                    'Coba lagi setelah koneksi pulih.'
                );
                this.closeDeleteModal();
                return;
            }

            try {
                await Auth.deleteEntry(this.deleteTargetId);
                this.data = this.data.filter(item => String(item.id) !== String(this.deleteTargetId));
                this.showToast('✅ Catatan dihapus (Cloud)');
                this.renderList();
            } catch (error) {
                console.error('Delete error:', error);
                // Check if it's a network error
                if (error.message && (error.message.includes('fetch') || error.message.includes('network'))) {
                    if (typeof ConnectionMonitor !== 'undefined') {
                        ConnectionMonitor.showBanner('error');
                    }
                }
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

        // ⚠️ CONNECTION CHECK - Prevent partial reset
        if (!this.canPerformWriteOperation()) {
            this.showAlert(
                '⚠️ Tidak Dapat Mereset',
                'Koneksi internet diperlukan untuk mereset data cloud. ' +
                'Coba lagi setelah koneksi pulih untuk memastikan semua data terhapus.'
            );
            return;
        }

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
            // Check if it's a network error
            if (e.message && (e.message.includes('fetch') || e.message.includes('network'))) {
                if (typeof ConnectionMonitor !== 'undefined') {
                    ConnectionMonitor.showBanner('error');
                }
            }
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
            // Clear sync interval to prevent background errors after logout
            if (this.syncIntervalId) {
                clearInterval(this.syncIntervalId);
                this.syncIntervalId = null;
            }
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
        if (this.isSaving) return; // Prevent concurrent modification
        const entry = this.data.find(i => String(i.id) === String(id));
        if (!entry) return;
        this.isSaving = true;
        // Visual feedback
        const btn = document.querySelector(`button[data-action="highlight"][data-id="${id}"]`);
        if (btn) btn.style.opacity = '0.5';
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
        } finally {
            this.isSaving = false;
        }
    },

    async togglePin(id) {
        if (this.isSaving) return; // Prevent concurrent modification
        const entry = this.data.find(i => String(i.id) === String(id));
        if (!entry) return;
        this.isSaving = true;
        // Visual feedback
        const btn = document.querySelector(`button[data-action="pin"][data-id="${id}"]`);
        if (btn) btn.style.opacity = '0.5';
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
        } finally {
            this.isSaving = false;
        }
    },

    toggleExportSelection(id) {
        const idStr = String(id);
        if (this.excludedExportIds.has(idStr)) {
            this.excludedExportIds.delete(idStr);
            this.showToast('✅ Catatan disertakan untuk WhatsApp/Copy');
        } else {
            this.excludedExportIds.add(idStr);
            this.showToast('❌ Catatan dikecualikan dari WhatsApp/Copy');
        }

        // Update DOM element directly instead of re-rendering full list
        const btn = document.querySelector(`button[data-action="toggle-export"][data-id="${id}"]`);
        if (btn) {
            btn.classList.toggle('excluded', this.excludedExportIds.has(idStr));
        }

        this.saveExportPreferences();
    },

    saveExportPreferences() {
        const excludedArray = Array.from(this.excludedExportIds);

        // Sync to cloud (single source of truth - no localStorage)
        Auth.updatePreferences({ excludedExports: excludedArray }).catch(err => {
            console.warn('Failed to sync export preferences:', err);
        });
    },

    toggleTxtSelection(id) {
        const idStr = String(id);
        if (this.excludedTxtIds.has(idStr)) {
            this.excludedTxtIds.delete(idStr);
            this.showToast('✅ Catatan disertakan untuk Download TXT');
        } else {
            this.excludedTxtIds.add(idStr);
            this.showToast('❌ Catatan dikecualikan dari Download TXT');
        }

        // Update DOM element directly instead of re-rendering full list
        const btn = document.querySelector(`button[data-action="toggle-txt"][data-id="${id}"]`);
        if (btn) {
            btn.classList.toggle('excluded', this.excludedTxtIds.has(idStr));
        }

        this.saveTxtPreferences();
    },

    saveTxtPreferences() {
        const excludedArray = Array.from(this.excludedTxtIds);

        // Sync to cloud (single source of truth - no localStorage)
        Auth.updatePreferences({ excludedTxts: excludedArray }).catch(err => {
            console.warn('Failed to sync txt preferences:', err);
        });
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
                         <button class="btn-icon action-edit" data-action="edit" data-id="${cleanId}" aria-label="Edit">
                             <svg pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                         </button>
                         <button class="btn-icon action-star ${item.highlight ? 'active' : ''}" data-action="highlight" data-id="${cleanId}" aria-label="Highlight">
                             <svg pointer-events="none" viewBox="0 0 24 24" fill="${item.highlight ? 'currentColor' : 'none'}" stroke="${item.highlight ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                         </button>
                         <button class="btn-icon action-pin ${item.pinned ? 'active' : ''}" data-action="pin" data-id="${cleanId}" aria-label="Pin">
                              <svg pointer-events="none" viewBox="0 0 24 24" fill="${item.pinned ? 'currentColor' : 'none'}" stroke="${item.pinned ? 'none' : 'currentColor'}" stroke-width="2" style="width:18px;height:18px;"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                         </button>
                         <button class="btn-icon action-export-toggle ${this.excludedExportIds.has(String(item.id)) ? 'excluded' : ''}" data-action="toggle-export" data-id="${cleanId}" aria-label="Toggle WhatsApp/Copy" title="Include/Exclude dari WhatsApp/Copy">
                             <!-- Copy/WA Icon -->
                             <svg class="icon-include" pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                             <svg class="icon-exclude" pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                         </button>
                         <button class="btn-icon action-txt-toggle ${this.excludedTxtIds.has(String(item.id)) ? 'excluded' : ''}" data-action="toggle-txt" data-id="${cleanId}" aria-label="Toggle TXT Download" title="Include/Exclude dari TXT Download">
                             <!-- File Icon for TXT -->
                             <svg class="icon-include" pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                             <svg class="icon-exclude" pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line><line x1="9" y1="15" x2="15" y2="15"></line><line x1="15" y1="12" x2="9" y2="18"></line><line x1="9" y1="12" x2="15" y2="18"></line></svg>
                         </button>
                         <button class="btn-icon action-delete" data-action="delete" data-id="${cleanId}" aria-label="Hapus">
                             <svg pointer-events="none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
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

                // SECURITY: Validate base64 format before injecting into DOM
                if (imageData && typeof imageData === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)) {
                    container.innerHTML = `<img src="${imageData}" style="width:100%; border-radius:8px; display:block; box-shadow: var(--shadow-sm);" loading="lazy" alt="Attachment">`;

                    // Simple modal for image view
                    const img = container.querySelector('img');
                    img.style.cursor = 'zoom-in';
                    img.addEventListener('click', () => {
                        const modal = document.createElement('div');
                        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;animation:fadeIn 0.2s;';
                        modal.innerHTML = `<img src="${imageData}" style="max-width:95%;max-height:95vh;border-radius:4px;box-shadow:0 0 30px rgba(0,0,0,0.5);">`;
                        modal.addEventListener('click', () => modal.remove());
                        document.body.appendChild(modal);
                    });

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

        // Sync to Cloud
        Auth.updatePreferences({ theme: next }).catch(err => {
            console.warn('Failed to sync theme preference:', err);
        });
    },

    updateThemeIcon(theme) {
        const btn = document.getElementById('themeToggle');
        if (!btn) return;
        if (theme === 'dark') {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg><span class="desktop-only">Tema</span>`;
        } else {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg><span class="desktop-only">Tema</span>`;
        }
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

    /**
     * Shows a connection required alert when app can't connect to server
     * This is a more prominent notification than a simple toast
     */
    showConnectionRequiredAlert() {
        this.showAlert(
            '🔌 Koneksi Diperlukan',
            'Aplikasi ini membutuhkan koneksi internet untuk berfungsi penuh. ' +
            'Pastikan Anda terhubung ke internet dan coba muat ulang halaman.\n\n' +
            '• Data tidak dapat disinkronkan\n' +
            '• Perubahan tidak dapat disimpan\n' +
            '• Konten mungkin tidak lengkap'
        );
    },

    /**
     * Checks if the app can perform write operations
     * Returns false and shows banner if offline
     */
    canPerformWriteOperation() {
        if (typeof ConnectionMonitor !== 'undefined' && ConnectionMonitor.shouldBlockOperation()) {
            ConnectionMonitor.showBanner(!navigator.onLine ? 'offline' : 'error');
            return false;
        }
        if (!navigator.onLine) {
            if (typeof ConnectionMonitor !== 'undefined') {
                ConnectionMonitor.showBanner('offline');
            } else {
                this.showToast('⚠️ Tidak ada koneksi internet');
            }
            return false;
        }
        return true;
    },

    async copyText() {
        // Use filtered data so user can copy specific views (e.g. per month)
        let dataToExport = this.getFilteredData();
        dataToExport = dataToExport.filter(i => !this.excludedExportIds.has(String(i.id)));

        if (!dataToExport || dataToExport.length === 0) {
            this.showToast('⚠️ Tidak ada data untuk disalin');
            return;
        }

        // Format: WhatsApp Friendly - Clean & Simple
        const lines = dataToExport.map((i, index) => {
            const date = this.formatDate(i.date);
            const type = i.type.toUpperCase();

            // Format notes with bullet points for multi-line
            let notesSection = '';
            if (i.reason && i.reason.trim()) {
                const noteLines = i.reason
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);

                if (noteLines.length === 1) {
                    notesSection = `\n• ${noteLines[0]}`;
                } else {
                    notesSection = '\n' + noteLines.map(line => `• ${line}`).join('\n');
                }
            }

            return `*${index + 1}. ${i.title}*\n${date} | ${type}${notesSection}`;
        });

        const header = `*JURNAL KEUANGAN*\n${dataToExport.length} Catatan • ${new Date().toLocaleDateString('id-ID')}\n${'─'.repeat(20)}\n\n`;
        const txt = header + lines.join('\n\n');

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(txt);
                this.showToast('✅ Laporan disalin ke clipboard');
            } else {
                console.warn('Clipboard API tidak tersedia');
            }
        } catch (err) {
            console.warn('Gagal salin ke clipboard:', err);
            const isMobileCheck = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
            if (!isMobileCheck) {
                this.showToast('❌ Gagal menyalin: ' + err.message);
            }
        }

        try {
            // Mobile Detection & Redirect (Always attempt on mobile)
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

            if (isMobile) {
                this.showToast('🚀 Mengalihkan ke WhatsApp...');
                // BUG FIX: Safari/Chrome will block window.open inside a setTimeout 
                // because it loses the "UI Event" trusted context. 
                // It must be called synchronously inside this handler.
                window.location.href = `https://wa.me/?text=${encodeURIComponent(txt)}`;
            }
        } catch (err) {
            console.error('WhatsApp redirect err:', err);
            this.showToast('❌ Gagal mengalihkan ke WhatsApp');
        }
    },

    downloadTxt() {
        let dataToExport = this.getFilteredData();
        dataToExport = dataToExport.filter(i => !this.excludedTxtIds.has(String(i.id)));

        if (!dataToExport || dataToExport.length === 0) {
            this.showToast('⚠️ Tidak ada data untuk diunduh');
            return;
        }

        // Build header with export metadata
        const dateStart = document.getElementById('dateStart').value;
        const dateEnd = document.getElementById('dateEnd').value;
        const filterType = document.getElementById('filterType').value;
        let header = `JURNAL KEUANGAN\nDiekspor: ${new Date().toLocaleDateString('id-ID')}\n`;
        if (dateStart || dateEnd) header += `Periode: ${dateStart || '...'} s/d ${dateEnd || '...'}\n`;
        if (filterType) header += `Kategori: ${filterType.toUpperCase()}\n`;
        header += `Total: ${dataToExport.length} catatan\n${'='.repeat(40)}\n\n`;

        const body = dataToExport.map((i, idx) => {
            let entry = `${idx + 1}. ${i.date} [${i.type.toUpperCase()}]: ${i.title}`;
            if (i.reason && i.reason.trim()) entry += `\n   Catatan: ${i.reason}`;
            return entry;
        }).join('\n\n');

        const txt = header + body;
        // UTF-8 BOM for proper Unicode display in all editors
        const blob = new Blob(['\uFEFF' + txt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Include date context in filename
        const dateSuffix = dateStart && dateEnd ? `_${dateStart}_${dateEnd}` : `_${new Date().toISOString().slice(0, 10)}`;
        a.download = `jurnal${dateSuffix}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Prevent memory leak
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        this.showToast('✅ File TXT berhasil diunduh');
    },

    formatDate(d) {
        if (!d) return '-';
        const date = new Date(d);
        return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    },

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});

