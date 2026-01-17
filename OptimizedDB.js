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
        this.dbVersion = 3;
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

                // Store 3: Restore Cache (Persistence)
                if (!db.objectStoreNames.contains('restore_cache')) {
                    db.createObjectStore('restore_cache', { keyPath: 'id' });
                }
            };
        });

        return this.openPromise;
    }

    // ====================
    // ENTRY OPERATIONS (Text Data)
    // ====================

    /**
     * Get all entries (NO images, lightweight) - With Progress
     */

    /**
     * Get all entries (NO images, lightweight) - Optimized with getAll
     */
    async getAllEntries(onProgress) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readonly');
            const store = transaction.objectStore(this.entryStore);

            // getAll is significantly faster than cursor for bulk reads
            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result;
                if (onProgress) onProgress(results.length, results.length);
                resolve(results);
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save or Update a single entry
     */
    async saveEntry(entry) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);
            const request = store.put(entry);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save Image Blob
     */
    async saveImage(entryId, imageData) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readwrite');
            const store = transaction.objectStore(this.imageStore);
            const request = store.put({ entryId, data: imageData });

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get Image by Entry ID
     */
    async getImage(entryId) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readonly');
            const store = transaction.objectStore(this.imageStore);
            const request = store.get(entryId);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.data : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete Entry (Just Text)
     */
    async deleteEntry(id) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore], 'readwrite');
            const store = transaction.objectStore(this.entryStore);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete Image
     */
    async deleteImage(id) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readwrite');
            const store = transaction.objectStore(this.imageStore);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete Full (Entry + Image)
     */
    async deleteFull(id) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.entryStore, this.imageStore], 'readwrite');

            transaction.objectStore(this.entryStore).delete(id);
            transaction.objectStore(this.imageStore).delete(id);

            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e);
        });
    }

    /**
     * Get all images (for backup/export only) - With Progress
     */
    async getAllImages(onProgress) {
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.imageStore], 'readonly');
            const store = transaction.objectStore(this.imageStore);

            // Using cursor for images to report granular progress and avoid massive memory spikes during object creation?
            // Actually, getAll() is still faster. Let's use count + cursor for progress, or chunks.
            // For true speed, getAll() is best. But for backup progress, we need steps.
            // Compromise: getAllKeys() then getAll() in chunks? Or just stick to cursor for images but optimized.

            // Let's stick to cursor for images to provide "Process..." feedback on large blobs
            const countReq = store.count();

            countReq.onsuccess = () => {
                const total = countReq.result;
                if (total === 0) return resolve([]);

                const items = [];
                const request = store.openCursor();
                let processed = 0;
                const updateInterval = Math.max(1, Math.ceil(total / 50));

                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        items.push(cursor.value);
                        processed++;
                        if (onProgress && processed % updateInterval === 0) {
                            onProgress(processed, total);
                        }
                        cursor.continue();
                    } else {
                        if (onProgress) onProgress(total, total);
                        resolve(items);
                    }
                };
                request.onerror = () => reject(request.error);
            };
            countReq.onerror = () => reject(countReq.error);
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
            try {
                const estimate = await navigator.storage.estimate();
                return {
                    usage: estimate.usage,
                    quota: estimate.quota,
                    usageInMB: (estimate.usage / (1024 * 1024)).toFixed(2),
                    quotaInGB: (estimate.quota / (1024 * 1024 * 1024)).toFixed(2),
                    percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
                };
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    /**
     * Count entries and images
     */
    async getStats() {
        if (!this.db) await this.open();

        // Fast count
        const entryCount = await this.countStore(this.entryStore);
        const imageCount = await this.countStore(this.imageStore);

        return {
            totalEntries: entryCount,
            totalImages: imageCount,
            // entriesWithImages calculation usually requires iteration, skip for speed or do separate index query
            // For now just return totals
            entriesWithImages: 0 // Placeholder to avoid full scan
        };
    }

    async countStore(storeName) {
        const tx = this.db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        return new Promise((resolve) => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(0);
        });
    }

    // ====================
    // ROBUST RESTORE SYSTEM (RESUME CAPABILITY)
    // ====================

    /**
     * Store raw backup data to survive refreshes
     */
    async saveRestorePoint(data) {
        if (!this.db) await this.open();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['restore_cache'], 'readwrite');
            const store = transaction.objectStore('restore_cache');
            store.put({ id: 'latest_backup', data: data, timestamp: Date.now() });
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e);
        });
    }

    async getRestorePoint() {
        if (!this.db) await this.open();
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['restore_cache'], 'readonly');
            const store = transaction.objectStore('restore_cache');
            const request = store.get('latest_backup');
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = () => resolve(null);
        });
    }

    async deleteRestorePoint() {
        if (!this.db) await this.open();
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['restore_cache'], 'readwrite');
            transaction.objectStore('restore_cache').clear();
            transaction.oncomplete = () => resolve();
        });
    }

    /**
     * GENERIC FAST BULK PUT WITH PROGRESS
     * Fire-and-forget style requests for maximum throughput
     */
    async bulkPut(storeName, items, onProgress) {
        if (!items || items.length === 0) return;
        if (!this.db) await this.open();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            let completed = 0;
            const total = items.length;
            const updateInterval = Math.max(1, Math.ceil(total / 50));

            items.forEach(item => {
                const req = store.put(item);
                req.onsuccess = () => {
                    completed++;
                    if (onProgress && completed % updateInterval === 0) {
                        onProgress(completed, total);
                    }
                };
                req.onerror = (e) => {
                    // Log but continue? Or fail? Fail for data integrity.
                    console.error('Bulk Put Error', e);
                }
            });

            transaction.oncomplete = () => {
                if (onProgress) onProgress(total, total); // Ensure 100%
                resolve();
            };

            transaction.onerror = (e) => reject(e.target.error);
        });
    }


}

// Export for use - Hybrid (Node/Window/Worker)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OptimizedJournalDB;
} else {
    self.OptimizedJournalDB = OptimizedJournalDB;
}

