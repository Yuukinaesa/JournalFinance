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

    async init() {
        try {
            // Initialize OptimizedDB (V2)
            await this.db.open();

            // Load entries
            this.data = await this.db.getAllEntries();

            // Migration Logic
            if (this.data.length === 0) {
                await this.migrateFromLocalStorage();
            }

            // Ensure data is array
            if (!Array.isArray(this.data)) this.data = [];

            // PWA Registration
            this.registerServiceWorker();

            // Setup Theme
            this.initTheme();

            // Setup Event Listeners (Security: No inline handlers)
            this.initEventListeners();

            // Initial Render
            this.renderList();

        } catch (e) {
            console.error('Core init error:', e);
            this.data = [];
            this.showToast('⚠️ Error loading data. Using empty dataset.');
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
        bind('triggerRestoreBtn', 'click', () => document.getElementById('importFile').click());
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
                    // Security check
                    if (imageData.startsWith('data:image/')) {
                        img.src = imageData;
                        img.alt = 'Lampiran Gambar Catatan'; // Accessibility Fix
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
        const search = (document.getElementById('searchInput').value || '').toLowerCase();
        const typeFilter = document.getElementById('filterType').value;
        const startDate = document.getElementById('dateStart').value;
        const endDate = document.getElementById('dateEnd').value;

        return this.data.filter(item => {
            const matchSearch = (item.title || '').toLowerCase().includes(search) ||
                (item.reason || '').toLowerCase().includes(search);
            const matchType = typeFilter ? item.type === typeFilter : true;
            let matchDate = true;
            if (startDate) matchDate = matchDate && (item.date >= startDate);
            if (endDate) matchDate = matchDate && (item.date <= endDate);
            return matchSearch && matchType && matchDate;
        }).sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            if (b.date > a.date) return 1;
            if (b.date < a.date) return -1;
            return String(b.id).localeCompare(String(a.id));
        });
    },

    openModal(isEdit = false) {
        if (this.closeTimeout) clearTimeout(this.closeTimeout);
        const modal = document.getElementById('entryModal');
        modal.classList.add('open');

        if (!isEdit) {
            document.getElementById('entryForm').reset();
            document.getElementById('entryId').value = '';
            document.getElementById('modalTitle').innerText = 'Tambah Catatan Baru';
            this.clearImage();

            const d = new Date();
            document.getElementById('entryDate').value = d.toISOString().slice(0, 10);
        }
    },

    closeModal() {
        document.getElementById('entryModal').classList.remove('open');
        this.closeTimeout = setTimeout(() => {
            document.getElementById('entryForm').reset();
            document.getElementById('entryId').value = '';
            document.getElementById('modalTitle').innerText = 'Tambah Catatan Baru';
        }, 200);
    },

    toggleTheme() {
        const current = document.body.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        this.updateThemeIcon(next);
    },

    updateThemeIcon(theme) {
        const btn = document.getElementById('themeToggle');
        // Simple SVG switch
        if (theme === 'dark') {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        } else {
            btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        }
    },

    escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    },

    formatDate(dateStr) {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    },

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.innerText = msg;
        toast.classList.add('show');
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
    },

    // --- IO ---

    generateTxtContent(data) {
        return data.map(item => `Tanggal: ${item.date}\nJudul: ${item.title}\nCatatan: ${item.reason || '-'}`).join('\n\n');
    },

    copyText() {
        const filtered = this.getFilteredData();
        if (filtered.length === 0) return this.showToast('No data');
        const content = this.generateTxtContent(filtered);
        navigator.clipboard.writeText(content).then(() => this.showToast('Copied!')).catch(() => this.showToast('Failed to copy'));
    },

    downloadTxt() {
        const filtered = this.getFilteredData();
        if (filtered.length === 0) return this.showToast('No data');
        const blob = new Blob([this.generateTxtContent(filtered)], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `journal_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
    },

    async backupData() {
        try {
            const entries = await this.db.getAllEntries();
            const images = await this.db.getAllImages();
            const backup = { version: 2, timestamp: new Date().toISOString(), entries, images };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `backup_v2_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            this.showToast('Backup downloaded');
        } catch (e) { console.error(e); }
    },

    resetFilters() {
        document.getElementById('searchInput').value = '';
        document.getElementById('filterType').value = '';
        document.getElementById('dateStart').value = '';
        document.getElementById('dateEnd').value = '';
        this.renderList();
        this.showToast('Filters reset');
    },

    async restoreData(input) {
        // Logic same as original, just connected to listener
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                if (json.version === 2 && json.entries) {
                    await this.db.bulkSaveEntries(json.entries);
                    if (json.images) {
                        for (const img of json.images) {
                            if (img.data && img.data.startsWith('data:image/')) await this.db.saveImage(img.entryId, img.data);
                        }
                    }
                    this.showToast('Data Restored');
                } else {
                    alert('Invalid format');
                }
                this.data = await this.db.getAllEntries();
                this.renderList();
            } catch (err) { console.error(err); alert('Restore Failed'); }
            input.value = '';
        };
        reader.readAsText(file);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
