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
    /**
     * Open database with two object stores: entries & images
     * Implements Singleton Promise Pattern to prevent race conditions
     */
    async open() {
        if (this.db) return this.db;
        if (this.openPromise) return this.openPromise;

        this.openPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('❌ IndexedDB Error:', request.error);
                this.openPromise = null; // Reset on failure
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                // Handle generic error for durability
                this.db.onversionchange = () => {
                    this.db.close();
                    this.db = null;
                };
                this.openPromise = null; // Cleanup
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
                }

                // Store 2: Images (separate blob storage)
                if (!db.objectStoreNames.contains(this.imageStore)) {
                    db.createObjectStore(this.imageStore, { keyPath: 'entryId' });
                }
            };
        });

        return this.openPromise;
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
                console.error('Database Error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Save/Update SINGLE entry (EFFICIENT - no full rewrite!)
     * @param {Object} entry - Entry object with required 'id' field
     * @throws {Error} If entry is invalid or missing required fields
     */
    async saveEntry(entry) {
        // SECURITY: Input validation
        if (!entry || typeof entry !== 'object') {
            throw new Error('Invalid entry: must be an object');
        }
        if (!entry.id) {
            throw new Error('Invalid entry: missing required id field');
        }
        // Ensure id is string for consistent indexing
        entry.id = String(entry.id);

        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);

            // PUT = update if exists, add if not (SINGLE operation)
            const request = store.put(entry);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Database Save Error:', request.error);
                reject(request.error);
            };
        });
    }

    /**
     * Bulk save entries (for import/restore ONLY)
     * @param {Array} entries - Array of entry objects
     */
    async bulkSaveEntries(entries) {
        // Handle empty array edge case
        if (!Array.isArray(entries)) {
            throw new Error('Invalid entries: must be an array');
        }
        if (entries.length === 0) {
            return Promise.resolve(); // Nothing to save
        }

        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);

            // Use PUT (upsert), NOT clear+add
            let completed = 0;
            const total = entries.length;
            let hasError = false;

            entries.forEach(entry => {
                // Validate each entry
                if (!entry || !entry.id) {
                    console.warn('Skipping invalid entry:', entry);
                    completed++;
                    if (completed === total && !hasError) resolve();
                    return;
                }
                entry.id = String(entry.id); // Normalize ID

                const request = store.put(entry);
                request.onsuccess = () => {
                    completed++;
                    if (completed === total && !hasError) {
                        resolve();
                    }
                };
                request.onerror = () => {
                    hasError = true;
                    console.error('Entry save error:', request.error);
                };
            });

            transaction.onerror = () => {
                console.error('Database Bulk Save Error:', transaction.error);
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
                resolve();
            };

            request.onerror = () => {
                console.error('Database Delete Error:', request.error);
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
                resolve();
            };

            transaction.onerror = () => {
                console.error('Full Delete Error:', transaction.error);
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
                resolve();
            };

            request.onerror = () => {
                console.error('Image Save Error:', request.error);
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
                console.error('Image Load Error:', request.error);
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
                resolve();
            };

            request.onerror = () => {
                console.error('Image Delete Error:', request.error);
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
                console.error('Get All Images Error:', request.error);
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
                resolve();
            };

            transaction.onerror = () => {
                console.error('Clear DB Error:', transaction.error);
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
