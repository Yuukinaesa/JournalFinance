-- Migration: Enable ON DELETE CASCADE for users -> entries
-- SQLite requires recreating table to change Foreign Keys

-- 1. Create new table with CASCADE
CREATE TABLE IF NOT EXISTS entries_new (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL DEFAULT 0,
    reason TEXT,
    highlight BOOLEAN DEFAULT 0,
    pinned BOOLEAN DEFAULT 0,
    has_image BOOLEAN DEFAULT 0,
    image_data TEXT, -- Include this from previous migration
    timestamp INTEGER,
    last_synced INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Copy data
INSERT INTO entries_new (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp, last_synced)
SELECT id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp, last_synced FROM entries;

-- 3. Swap tables
DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;

-- 4. Create indexes (optional but good for performance)
CREATE INDEX IF NOT EXISTS idx_entries_user_id ON entries(user_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
