-- Tabel Users untuk menyimpan data login
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE, -- Username opsional tapi unik jika ada
    password_hash TEXT NOT NULL,
    token_version INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Tabel Reset Tokens untuk Lupa Password
CREATE TABLE IF NOT EXISTS reset_tokens (
    email TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

-- Tabel Entries (Catatan Jurnal)
-- Disinkronkan dengan ID dari pengguna
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY, -- Menggunakan ID UUID/String dari frontend agar konsisten
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL DEFAULT 0,
    reason TEXT,
    highlight BOOLEAN DEFAULT 0,
    pinned BOOLEAN DEFAULT 0,
    has_image BOOLEAN DEFAULT 0,
    image_data TEXT, -- Base64 string for cloud storage
    timestamp INTEGER,
    last_synced INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
