/**
 * ======================================================================
 * BACKGROUND WORKER - DB OPERATIONS
 * ======================================================================
 * Handles potentially blocking database and JSON operations
 * off the main thread to ensure UI responsiveness.
 * ======================================================================
 */

// Import shared DB logic
importScripts('./OptimizedDB.js');

const db = new OptimizedJournalDB();
let dbOpened = false;

// Helpers
const postProgress = (type, current, total, stage = '') => {
    self.postMessage({ type: 'progress', operation: type, current, total, stage });
};

const postSuccess = (type, data = null) => {
    self.postMessage({ type: 'success', operation: type, data });
};

const postError = (type, error) => {
    self.postMessage({ type: 'error', operation: type, error: error.message || error });
};

// Message Handler
self.onmessage = async (e) => {
    const { action, payload } = e.data;

    try {
        if (!dbOpened) {
            await db.open();
            dbOpened = true;
        }

        switch (action) {
            case 'backup':
                await handleBackup();
                break;

            case 'restore':
                await handleRestore(payload);
                break;

            case 'reset':
                await handleReset();
                break;

            case 'resume':
                await handleResume();
                break;

            default:
                throw new Error('Unknown action: ' + action);
        }

    } catch (err) {
        console.error('Worker Error:', err);
        postError(action, err);
    }
};

async function handleResume() {
    postProgress('restore', 0, 100, 'checking_cache');
    const json = await db.getRestorePoint();
    if (!json) {
        throw new Error('Data backup tidak ditemukan.');
    }
    // Reuse handleRestore logic but skip saving restore point (it's already there)
    // Actually handleRestore saves it again. It's fine, just overwrites.
    // However, fast path:
    await handleRestore(json);
}


/**
 * Handle Backup Operation
 * 1. Fetch entries
 * 2. Fetch images
 * 3. Serialize to JSON blob
 */
async function handleBackup() {
    try {
        postProgress('backup', 0, 100, 'initializing');

        let entries = [];
        let images = [];

        // 1. Entries
        postProgress('backup', 0, 100, 'fetching_entries');
        entries = await db.getAllEntries((c, t) => {
            // Map entry progress 0-20%
            // getAll() is instant mostly, so this might jump to 100 immediately
        });
        postProgress('backup', 20, 100, 'fetching_images');

        // 2. Images
        images = await db.getAllImages((c, t) => {
            // Map image progress 20-80%
            const pct = 20 + (c / t * 60);
            postProgress('backup', pct, 100, 'fetching_images');
        });

        // 3. Serialize
        postProgress('backup', 80, 100, 'compressing');

        // Use timeout to let progress post message go through
        await new Promise(r => setTimeout(r, 0));

        const backupData = {
            version: 2,
            timestamp: new Date().toISOString(),
            entries,
            images
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });

        // Pass blob back to main thread
        postProgress('backup', 95, 100, 'preparing_download');
        postSuccess('backup', blob);

    } catch (e) {
        throw e;
    }
}

/**
 * Handle Restore Operation
 * 1. Parse JSON (handled in logic or passed as object? Text is passed usually)
 *    If payload is File, we can read it here? FileReader is sync in workers? 
 *    Actually FileReader works in workers.
 *    But main thread reading is fine. Let's assume payload is the attributes or we read file here.
 *    For large files, transferring ArrayBuffer is better.
 */
async function handleRestore(fileOrData) {
    try {
        let json;

        postProgress('restore', 0, 100, 'parsing');

        if (fileOrData instanceof Blob || fileOrData instanceof File) {
            const text = await new Response(fileOrData).text();
            json = JSON.parse(text);
        } else if (typeof fileOrData === 'string') {
            json = JSON.parse(fileOrData);
        } else {
            json = fileOrData;
        }

        // Detect Legacy Format (Array) and Normalize
        if (Array.isArray(json)) {
            // Convert to V2 structure with Strict Sanitization
            const entries = [];
            const images = [];

            json.forEach(item => {
                // Strict Allowlist
                const entry = {
                    id: String(item.id || Date.now() + Math.random()),
                    date: String(item.date || new Date().toISOString().slice(0, 10)),
                    title: String(item.title || 'Untitled'),
                    type: String(item.type || 'lainnya'),
                    reason: String(item.reason || ''),
                    highlight: !!item.highlight,
                    pinned: !!item.pinned,
                    timestamp: Number(item.timestamp) || Date.now(),
                    hasImage: false // Will be set below
                };

                // Extract embedded image
                if (item.image && typeof item.image === 'string') {
                    images.push({
                        entryId: entry.id,
                        data: item.image
                    });
                    entry.hasImage = true;
                } else if (item.hasImage) {
                    entry.hasImage = true; // Trust existing flag if no image data but maybe in images store (if V2)
                }

                entry.amount = parseFloat(item.amount) || 0;

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
            throw new Error('Format file tidak valid / versi tidak didukung.');
        }

        const totalEntries = json.entries.length;
        const totalImages = (json.images || []).length;
        const totalItems = totalEntries + totalImages;
        let processed = 0;

        // 1. Save Restore Point (Persistence)
        postProgress('restore', 5, 100, 'saving_checkpoint');
        await db.saveRestorePoint(json);

        // 2. Clear Database
        postProgress('restore', 10, 100, 'clearing_db');
        await db.clearAll();

        // 3. Restore Entries
        if (totalEntries > 0) {
            postProgress('restore', 15, 100, ' restoring_entries');
            await db.bulkPut('entries', json.entries, (c, t) => {
                const pct = 15 + (c / totalEntries * 35); // 15-50%
                postProgress('restore', pct, 100, 'restoring_entries');
            });
        }

        // 4. Restore Images
        if (totalImages > 0) {
            postProgress('restore', 50, 100, 'restoring_images');
            const imageChunks = json.images.filter(img => img.data && img.data.startsWith('data:image/'));

            await db.bulkPut('images', imageChunks, (c, t) => {
                const pct = 50 + (c / totalImages * 45); // 50-95%
                postProgress('restore', pct, 100, 'restoring_images');
            });
        }

        // Cleanup
        await db.deleteRestorePoint();

        postProgress('restore', 100, 100, 'finalize');
        postSuccess('restore');

    } catch (e) {
        throw e;
    }
}

async function handleReset() {
    postProgress('reset', 0, 100, 'clearing');
    await db.clearAll();
    await db.deleteRestorePoint();
    postProgress('reset', 100, 100, 'clearing');
    postSuccess('reset');
}
