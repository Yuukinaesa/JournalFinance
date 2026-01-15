/**
 * ============================================================================
 * PROFESSIONAL INDEXEDDB MANAGER - OPTIMIZED ARCHITECTURE
 * ============================================================================
 * Features:
 * - Separate image storage (blob store)
 * - Individual entry updates (no full rewrites)
 * - Efficient batch operations
 * - Memory-efficient lazy loading
 * - Professional error handling
 * ============================================================================
 */

class OptimizedJournalDB {
    constructor() {
        this.dbName = 'JournalFinanceDB_V2';
        this.dbVersion = 2;
        this.entryStore = 'entries';
        this.imageStore = 'images';
        this.db = null;
    }

    /**
     * Open database with two object stores: entries & images
     */
    async open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('❌ IndexedDB Error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ IndexedDB opened successfully (V2 Optimized)');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Store 1: Entries (lightweight text data only)
                if (!db.objectStoreNames.contains(this.entryStore)) {
                    const entryStore = db.createObjectStore(this.entryStore, { keyPath: 'id' });
                    entryStore.createIndex('date', 'date', { unique: false });
                    entryStore.createIndex('type', 'type', { unique: false });
                    entryStore.createIndex('timestamp', 'timestamp', { unique: false });
                    entryStore.createIndex('pinned', 'pinned', { unique: false });
                    entryStore.createIndex('highlight', 'highlight', { unique: false });
                    console.log('📦 Created: entries store (text only)');
                }

                // Store 2: Images (separate blob storage)
                if (!db.objectStoreNames.contains(this.imageStore)) {
                    db.createObjectStore(this.imageStore, { keyPath: 'entryId' });
                    console.log('📦 Created: images store (blobs)');
                }
            };
        });
    }

    // ====================
    // ENTRY OPERATIONS (Text Data)
    // ====================

    /**
     * Get all entries (NO images, lightweight)
     */
    async getAllEntries() {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readonly');
            const store = transaction.objectStore(this.entryStore);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => {
                console.error('❌ Get all entries error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Save/Update SINGLE entry (EFFICIENT - no full rewrite!)
     */
    async saveEntry(entry) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);

            // PUT = update if exists, add if not (SINGLE operation)
            const request = store.put(entry);

            request.onsuccess = () => {
                console.log('✅ Entry saved:', entry.id);
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('❌ Save entry error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Bulk save entries (for import/restore ONLY)
     */
    async bulkSaveEntries(entries) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);

            // Use PUT (upsert), NOT clear+add
            let completed = 0;
            const total = entries.length;

            entries.forEach(entry => {
                const request = store.put(entry);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total) {
                        console.log(`✅ Bulk saved ${total} entries`);
                        resolve();
                    }
                };
            });

            transaction.onerror = () => {
                console.error('❌ Bulk save error:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    /**
     * Delete entry by ID
     */
    async deleteEntry(id) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);
            const request = store.delete(String(id));

            request.onsuccess = () => {
                console.log('✅ Entry deleted:', id);
                resolve();
            };

            request.onerror = () => {
                console.error('❌ Delete entry error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Atomically delete entry AND its associated image (Transaction Safe)
     */
    async deleteFull(id) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore, this.imageStore], 'readwrite');

            // Delete from both stores simultaneously
            transaction.objectStore(this.entryStore).delete(String(id));
            transaction.objectStore(this.imageStore).delete(String(id));

            transaction.oncomplete = () => {
                console.log('✅ Full delete usage (Entry + Image) for:', id);
                resolve();
            };

            transaction.onerror = () => {
                console.error('❌ Full delete error:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    // ====================
    // IMAGE OPERATIONS (Separate Storage)
    // ====================

    /**
     * Save image for entry (separate from entry data)
     */
    async saveImage(entryId, imageDataUrl) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readwrite');
            const store = transaction.objectStore(this.imageStore);

            const imageData = {
                entryId: String(entryId),
                data: imageDataUrl,
                savedAt: Date.now()
            };

            const request = store.put(imageData);

            request.onsuccess = () => {
                console.log('✅ Image saved for entry:', entryId);
                resolve();
            };

            request.onerror = () => {
                console.error('❌ Save image error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get image for specific entry (lazy load)
     */
    async getImage(entryId) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readonly');
            const store = transaction.objectStore(this.imageStore);
            const request = store.get(String(entryId));

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.data : null);
            };

            request.onerror = () => {
                console.error('❌ Get image error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Delete image for entry
     */
    async deleteImage(entryId) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readwrite');
            const store = transaction.objectStore(this.imageStore);
            const request = store.delete(String(entryId));

            request.onsuccess = () => {
                console.log('✅ Image deleted for entry:', entryId);
                resolve();
            };

            request.onerror = () => {
                console.error('❌ Delete image error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Get all images (for backup/export only)
     */
    async getAllImages() {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readonly');
            const store = transaction.objectStore(this.imageStore);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => {
                console.error('❌ Get all images error:', request.error);
                reject(request.error);
            };
        });
    }

    // ====================
    // UTILITY METHODS
    // ====================

    /**
     * Clear all data (entries + images)
     */
    async clearAll() {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore, this.imageStore], 'readwrite');

            transaction.objectStore(this.entryStore).clear();
            transaction.objectStore(this.imageStore).clear();

            transaction.oncomplete = () => {
                console.log('✅ All data cleared');
                resolve();
            };

            transaction.onerror = () => {
                console.error('❌ Clear error:', transaction.error);
                reject(transaction.error);
            };
        });
    }

    /**
     * Get storage usage estimate
     */
    async getStorageEstimate() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                usageInMB: (estimate.usage / (1024 * 1024)).toFixed(2),
                quotaInGB: (estimate.quota / (1024 * 1024 * 1024)).toFixed(2),
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
            };
        }
        return null;
    }

    /**
     * Count entries and images
     */
    async getStats() {
        if (!this.db) await this.open();

        const entries = await this.getAllEntries();
        const images = await this.getAllImages();

        return {
            totalEntries: entries.length,
            totalImages: images.length,
            entriesWithImages: entries.filter(e => e.hasImage).length
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OptimizedJournalDB;
}
