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

window.app = {
    data: [],
    STORAGE_KEY: 'journalFinanceData', // Backward compatibility
    deleteTargetId: null,
    closeTimeout: null,
    db: new OptimizedJournalDB(), // Uses external OptimizedDB
    worker: null,

    async init() {
        try {
            // Initialize Worker with Safe Fallback
            try {
                if (window.Worker) {
                    this.worker = new Worker('worker-db.js');
                    this.worker.onerror = (e) => {
                        console.warn('Worker failed, falling back to main thread:', e);
                        this.worker = null;
                    };
                    this.initWorkerListener();
                }
            } catch (err) {
                console.warn('Could not initialize Worker (likely file:// protocol), falling back to main thread.', err);
                this.worker = null;
            }

            await this.db.open();
            this.data = await this.db.getAllEntries();

            // Migration
            if (this.data.length === 0) await this.migrateFromLocalStorage();
            if (!Array.isArray(this.data)) this.data = [];

            this.registerServiceWorker();
            this.initTheme();
            this.initEventListeners();
            this.renderList();

            // RESUME CHECK
            if (localStorage.getItem('APP_STATUS') === 'RESTORING') {
                this.resumeRestore();
            }

        } catch (e) {
            console.error('Core init error:', e);
            this.data = [];
            this.showToast('⚠️ Error initializing app.');
        }
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
                alert('Terjadi kesalahan: ' + error);
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
            // Reload data
            this.db.getAllEntries().then(entries => {
                this.data = entries;
                this.renderList();

                if (operation === 'restore') {
                    this.showToast('✅ Restore Selesai. Konfirmasi muat ulang...');
                    localStorage.removeItem('APP_STATUS');
                    setTimeout(() => {
                        window.onbeforeunload = () => true;
                        window.location.reload();
                    }, 2000);
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

            const entries = await this.db.getAllEntries();

            // 2. Images
            this.updateProgressUI(40, 'backup', 'fetching_images');
            await new Promise(r => setTimeout(r, 50));

            const images = await this.db.getAllImages((c, t) => {
                const pct = 40 + (c / t * 40);
                this.updateProgressUI(pct, 'backup', 'fetching_images');
            });

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

        if (!confirm('PERINGATAN: Restore akan MENGHAPUS semua data saat ini. Lanjut?')) {
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
                    alert('File corrupt: ' + err.message);
                    localStorage.removeItem('APP_STATUS');
                }
            };
            reader.readAsText(file);
        }

        input.value = '';
    },

    async resumeRestore() {
        if (!confirm('Pemberitahuan: Sistem mendeteksi proses restore yang belum selesai. Lanjutkan sekarang?')) {
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
                alert('Gagal resume: ' + e.message);
            }
        }
    },

    async processRestoreMain(json) {
        try {
            // Detect Legacy Format (Array) and Normalize
            if (Array.isArray(json)) {
                const entries = [];
                const images = [];

                json.forEach(item => {
                    const entry = {
                        id: String(item.id || Date.now() + Math.random()),
                        date: String(item.date || new Date().toISOString().slice(0, 10)),
                        title: String(item.title || 'Untitled'),
                        type: String(item.type || 'lainnya'),
                        reason: String(item.reason || ''),
                        highlight: !!item.highlight,
                        pinned: !!item.pinned,
                        timestamp: Number(item.timestamp) || Date.now(),
                        hasImage: false
                    };

                    if (item.image && typeof item.image === 'string') {
                        images.push({
                            entryId: entry.id,
                            data: item.image
                        });
                        entry.hasImage = true;
                    } else if (item.hasImage) {
                        entry.hasImage = true;
                    }
                    entries.push(entry);
                });

                json = {
                    version: 2,
                    timestamp: new Date().toISOString(),
                    entries: entries,
                    images: images
                };
            }

            if (json.version !== 2 || !Array.isArray(json.entries)) {
                throw new Error('Format file tidak valid.');
            }

            // 1. Save checkpoint
            this.updateProgressUI(5, 'restore', 'saving_checkpoint');
            await this.db.saveRestorePoint(json);

            // 2. Clear
            this.updateProgressUI(10, 'restore', 'clearing_db');
            await this.db.clearAll();

            const totalEntries = json.entries.length;
            const totalImages = (json.images || []).length;

            // 3. Entries
            if (totalEntries > 0) {
                this.updateProgressUI(15, 'restore', 'restoring_entries');
                await this.db.bulkPut('entries', json.entries, (c, t) => {
                    const pct = 15 + (c / totalEntries * 35);
                    this.updateProgressUI(pct, 'restore', 'restoring_entries');
                });
            }

            // 4. Images
            if (totalImages > 0) {
                this.updateProgressUI(50, 'restore', 'restoring_images');
                const imageChunks = json.images.filter(img => img.data && img.data.startsWith('data:image/'));
                await this.db.bulkPut('images', imageChunks, (c, t) => {
                    const pct = 50 + (c / totalImages * 45);
                    this.updateProgressUI(pct, 'restore', 'restoring_images');
                });
            }

            // Cleanup
            await this.db.deleteRestorePoint();
            this.handleSuccess('restore');

        } catch (e) {
            console.error(e);
            this.hideProgress();
            alert('Gagal Restore: ' + e.message);
            localStorage.removeItem('APP_STATUS');
        }
    },

    // --- Reset ---

    async confirmReset() {
        const input = document.getElementById('resetConfirmInput');
        if (input.value.toLowerCase() !== 'yes') return;

        this.closeResetModal();
        this.showProgress(0, 'Menghapus Semua Data', 'Mohon tunggu...');

        if (this.worker) {
            this.worker.postMessage({ action: 'reset' });
        } else {
            try {
                await this.db.clearAll();
                // Also clear backup cache
                await this.db.deleteRestorePoint();
                localStorage.removeItem(this.STORAGE_KEY);
                localStorage.removeItem('APP_STATUS');
                this.handleSuccess('reset');
            } catch (e) {
                console.error('Reset error:', e);
                this.hideProgress();
                this.showToast('❌ Gagal reset storage');
            }
        }
    },

    async migrateFromLocalStorage() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    for (const entry of parsed) {
                        const imageData = entry.image;
                        delete entry.image;
                        entry.hasImage = !!imageData;
                        await this.db.saveEntry(entry);
                        if (imageData) {
                            await this.db.saveImage(entry.id, imageData);
                        }
                    }
                    this.data = await this.db.getAllEntries();
                    localStorage.removeItem(this.STORAGE_KEY);
                    this.showToast(`✅ Migrasi ${parsed.length} entri ke V2 berhasil!`);
                }
            } catch (e) {
                console.error('Migration error:', e);
            }
        }
    },

    registerServiceWorker() {
        if ('serviceWorker' in navigator && location.protocol !== 'file:') {
            navigator.serviceWorker.register('./sw.js')
                .catch(err => console.error('❌ SW registration failed:', err));

            // PWA Install Prompt
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredPrompt = e;
                const btn = document.getElementById('installBtn');
                if (btn) btn.style.display = 'flex';
            });
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
        bind('removeImgBtn', 'click', () => this.clearImage());

        // Delete Modal
        bind('closeDeleteModalBtn', 'click', () => this.closeDeleteModal());
        bind('cancelDeleteBtn', 'click', () => this.closeDeleteModal());
        bind('confirmDeleteBtn', 'click', () => this.confirmDelete());

        // Reset Modal
        // Reset Storage Trigger is dynamically rendered in stats, need event delegation there or bind later.
        // Actually, the button "RESET" is in the stats bar string. 
        // Better: Bind delegation on statsBar
        const statsBar = document.getElementById('statsBar');
        if (statsBar) {
            statsBar.addEventListener('click', (e) => {
                if (e.target.matches('[data-action="reset-storage"]')) {
                    this.initiateReset();
                }
            });
        }

        bind('closeResetModalBtn', 'click', () => this.closeResetModal());
        bind('cancelResetBtn', 'click', () => this.closeResetModal());
        bind('btnConfirmReset', 'click', () => this.confirmReset());

        // Reset Input Validation
        bind('resetConfirmInput', 'keyup', (e) => {
            const btn = document.getElementById('btnConfirmReset');
            if (e.target.value.toLowerCase() === 'yes') {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            } else {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });

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
            if (event.target == entryModal) this.closeModal();
            if (event.target == deleteModal) this.closeDeleteModal();
            if (event.target == resetModal) this.closeResetModal();
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
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
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
            title,
            reason,
            highlight,
            pinned,
            hasImage,
            timestamp: id ? (this.data.find(i => i.id === id)?.timestamp || Date.now()) : Date.now()
        };

        try {
            await this.db.saveEntry(entry);
            if (imageData) {
                await this.db.saveImage(entry.id, imageData);
            }
            if (id && this.pendingImageClear) {
                await this.db.deleteImage(entry.id);
                entry.hasImage = false;
            }

            if (id) {
                const index = this.data.findIndex(item => String(item.id) === String(id));
                if (index > -1) this.data[index] = entry;
                this.showToast('✅ Catatan diperbarui');
            } else {
                this.data.unshift(entry);
                this.showToast('✅ Catatan ditambahkan');
            }

            this.pendingImageClear = false;
            this.renderList();
            this.closeModal();

        } catch (error) {
            console.error('Save entry error:', error);
            this.showToast('❌ Error menyimpan. Silakan coba lagi.');
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
                await this.db.deleteFull(this.deleteTargetId);
                this.data = this.data.filter(item => String(item.id) !== String(this.deleteTargetId));
                this.showToast('✅ Catatan berhasil dihapus');
                this.renderList();
            } catch (error) {
                console.error('Delete error:', error);
                this.showToast('❌ Error menghapus.');
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
            await this.db.clearAll();
            this.data = [];
            localStorage.removeItem(this.STORAGE_KEY);
            this.showToast('✅ Semua data berhasil di-reset');
            this.renderList();
            this.closeResetModal();
        } catch (e) {
            console.error('Reset error:', e);
            this.showToast('❌ Gagal reset storage');
        }
    },

    editEntry(id) {
        const item = this.data.find(i => String(i.id) === String(id));
        if (!item) return;

        document.getElementById('entryId').value = item.id;
        document.getElementById('entryDate').value = item.date;
        document.getElementById('entryType').value = item.type;
        document.getElementById('entryTitle').value = item.title;
        document.getElementById('entryReason').value = item.reason || '';
        document.getElementById('entryHighlight').checked = !!item.highlight;
        document.getElementById('entryPin').checked = !!item.pinned;

        if (item.hasImage) {
            this.db.getImage(item.id).then(imageData => {
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
            await this.db.saveEntry(entry);
            this.renderList();
        } catch (e) { entry.highlight = !entry.highlight; }
    },

    async togglePin(id) {
        const entry = this.data.find(i => String(i.id) === String(id));
        if (!entry) return;
        try {
            entry.pinned = !entry.pinned;
            await this.db.saveEntry(entry);
            this.renderList();
        } catch (e) { entry.pinned = !entry.pinned; }
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
        const storageStats = await this.db.getStorageEstimate();

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
                         <span class="card-badge badge-${typeSafe}">${typeSafe}</span>
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

    loadImagesLazy() {
        const containers = document.querySelectorAll('.image-container');
        containers.forEach(async container => {
            const entryId = container.dataset.entryId;
            if (!entryId) return;

            try {
                const imageData = await this.db.getImage(entryId);
                if (imageData && container) {
                    container.innerHTML = '';
                    const img = document.createElement('img');
                    img.className = 'card-image';
                    img.style.cssText = 'width:100%; max-height:300px; object-fit:contain; border-radius:8px; border:1px solid var(--border-color); background:#000; animation: fadeIn 0.3s;';
                    if (imageData.startsWith('data:image/')) {
                        img.src = imageData;
                        img.alt = 'Lampiran Gambar Catatan';
                    }
                    container.appendChild(img);
                }
            } catch (err) {
                if (container) container.innerText = '⚠️ Gagal memuat gambar';
            }
        });
    },

    // --- Helpers ---

    getFilteredData() {
        let filtered = this.data;
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

    copyText() {
        const txt = this.data.map(i => `${i.date} [${i.type}]: ${i.title} - ${JSON.stringify(i.reason)}`).join('\n');
        navigator.clipboard.writeText(txt).then(() => this.showToast('Disalin ke clipboard'));
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

