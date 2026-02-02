
import worker from '../backend/worker.js';
import assert from 'node:assert/strict';

// --- MOCK ENVIRONMENT SETUP ---

// Polyfill Response if missing (Node environment)
if (!globalThis.Response) {
    throw new Error("Node.js version too old. Please use Node 18+");
}

/**
 * UPGRADED MOCK DATABASE
 * Supports: Users (Auth, Token Version), Entries (CRUD, Validation), Batch Operations
 */
class MockD1Database {
    constructor() {
        this.users = [];
        this.entries = [];
        this.lastId = 0;
    }

    prepare(query) {
        return new MockStatement(this, query);
    }

    async batch(stmts) {
        let results = [];
        for (const stmt of stmts) {
            results.push(await stmt.run());
        }
        return results;
    }

    // INTERNAL EXECUTION LOGIC
    _execute(sql, bindings, mode) {
        const lowerSql = sql.toLowerCase();

        // --- USER OPERATIONS ---

        // 1. Register
        if (lowerSql.includes('insert into users')) {
            const [email, username, password_hash] = bindings;
            // Check unique
            if (this.users.find(u => u.email === email)) throw new Error('UNIQUE constraint failed: users.email');

            const id = ++this.lastId;
            const newUser = { id, email, username, password_hash, token_version: 1 };
            this.users.push(newUser);
            return { meta: { last_row_id: id } };
        }

        // 2. Select User (Login/Verify)
        if (lowerSql.includes('select')) {
            if (lowerSql.includes('from users')) {
                let user;
                if (lowerSql.includes('username =')) user = this.users.find(u => u.username === bindings[0]);
                else if (lowerSql.includes('email =')) user = this.users.find(u => u.email === bindings[0]);
                else if (lowerSql.includes('id =')) user = this.users.find(u => u.id === bindings[0]);
                else if (lowerSql.includes('*')) { /* wildcard select */
                    if (lowerSql.includes('username =')) user = this.users.find(u => u.username === bindings[0]);
                    else if (lowerSql.includes('email =')) user = this.users.find(u => u.email === bindings[0]);
                }

                if (mode === 'first') return user || null;
                return { results: [user].filter(Boolean) };
            }
        }

        // 3. Update User (Logout All / Password Upgrade)
        if (lowerSql.includes('update users')) {
            const id = bindings[bindings.length - 1]; // ID is usually last binding
            const user = this.users.find(u => u.id === id);

            if (user) {
                if (lowerSql.includes('token_version')) {
                    user.token_version = (user.token_version || 1) + 1;
                }
                if (lowerSql.includes('password_hash')) {
                    user.password_hash = bindings[0];
                }
            }
            return { meta: { changes: 1 } };
        }

        // --- ENTRY OPERATIONS ---

        // 4. Insert Entry
        if (lowerSql.includes('insert or ignore into entries')) {
            // Bindings: id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp
            const entry = {
                id: bindings[0],
                user_id: bindings[1],
                date: bindings[2],
                title: bindings[3],
                type: bindings[4],
                amount: bindings[5],
                reason: bindings[6],
                highlight: bindings[7],
                pinned: bindings[8],
                has_image: bindings[9],
                image_data: bindings[10],
                timestamp: bindings[11]
            };
            this.entries.push(entry);
            return { success: true };
        }

        // 5. Select Entries
        if (lowerSql.includes('select') && lowerSql.includes('from entries')) {
            if (lowerSql.includes('count(*)')) {
                return { results: [{ count: this.entries.length }] };
            }

            // Default: All entries
            let results = this.entries;

            // HANDLE FILTERING
            // Case A: Get All (List) - "WHERE user_id = ? ORDER BY..."
            // Case B: Get One (Image/Detail) - "WHERE id = ? AND user_id = ?"

            if (lowerSql.includes('order by')) {
                // This is the LIST query
                const userIdVal = bindings[0];
                if (userIdVal !== undefined) {
                    results = results.filter(e => e.user_id == userIdVal);
                }
            }
            else if (lowerSql.includes('id = ?')) {
                // This is the SINGLE fetch query
                // Bindings: entryId, userId
                const entryId = bindings[0];
                // const userId = bindings[1]; // optional check

                const entry = this.entries.find(e => e.id === entryId);
                if (mode === 'first') return entry;
                results = [entry].filter(Boolean);
            }

            return { results };
        }

        // 6. Update Entry
        if (lowerSql.includes('update entries')) {
            const id = bindings[bindings.length - 2];
            const entry = this.entries.find(e => e.id === id);
            if (entry) {
                entry.date = bindings[0];
                entry.title = bindings[1];
                entry.amount = bindings[3];
            }
            return { meta: { changes: entry ? 1 : 0 } };
        }

        // 7. Delete Entry
        if (lowerSql.includes('delete from entries')) {
            const id = bindings[0];
            const initialLen = this.entries.length;
            this.entries = this.entries.filter(e => e.id !== id);
            return { meta: { changes: initialLen - this.entries.length } };
        }

        return { meta: { changes: 0 } };
    }
}

class MockStatement {
    constructor(db, sql) {
        this.db = db;
        this.sql = sql;
        this.bindings = [];
    }
    bind(...args) {
        this.bindings = args;
        return this;
    }
    async first() { return this.db._execute(this.sql, this.bindings, 'first'); }
    async all() { return this.db._execute(this.sql, this.bindings, 'all'); }
    async run() { return this.db._execute(this.sql, this.bindings, 'run'); }
}

// SETUP GLOBAL ENV
const env = {
    DB: new MockD1Database(),
    JWT_SECRET: 'qa-secure-secret-key-999',
    ASSETS: { fetch: async () => new Response("Asset") },
    ALLOWED_ORIGIN: 'https://qa.journalfinance.com'
};

const ctx = {
    waitUntil: () => { },
    passThroughOnException: () => { }
};

// --- TEST UTILS ---

function request(method, path, body = null, headers = {}) {
    return new Request(`http://localhost${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '127.0.0.1',
            ...headers
        },
        body: body ? JSON.stringify(body) : null
    });
}

async function runStep(name, fn) {
    try {
        process.stdout.write(`🔹 [QA] ${name.padEnd(50)} `);
        await fn();
        console.log("✅ PASS");
        return true;
    } catch (e) {
        console.log("❌ FAIL");
        console.error("   Error:", e.message);
        if (e.message.includes('AssertionError')) {
            console.error("   Expected:", e.expected);
            console.error("   Actual:", e.actual);
        }
        return false;
    }
}

// --- MAIN QA SUITE ---

async function runQASuite() {
    console.log(`\n🧪 STARTING COMPREHENSIVE QA TEST SUITE`);
    console.log(`=========================================\n`);

    let passed = 0;
    let failed = 0;
    const STATE = {}; // Store tokens, IDs, etc.

    // ----------------------------------------------------
    // SCENARIO 1: AUTHENTICATION
    // ----------------------------------------------------

    if (await runStep("1.1 Register User", async () => {
        const res = await worker.fetch(request('POST', '/api/auth/register', {
            email: "qa@example.com", username: "qauser", password: "password123"
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200, "Status should be 200");
        assert.ok(data.success, "Success should be true");
        STATE.userId = data.userId;
    })) passed++; else failed++;

    if (await runStep("1.2 Login & Get Tokens", async () => {
        const res = await worker.fetch(request('POST', '/api/auth/login', {
            email: "qa@example.com", password: "password123"
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.ok(data.accessToken, "Should have accessToken");
        assert.ok(data.refreshToken, "Should have refreshToken");

        STATE.accessToken = data.accessToken;
        STATE.refreshToken = data.refreshToken;
    })) passed++; else failed++;

    if (await runStep("1.3 Token Refresh", async () => {
        // Wait 1.1s to ensure token timestamp differs
        await new Promise(r => setTimeout(r, 1100));

        const res = await worker.fetch(request('POST', '/api/auth/refresh', {
            refreshToken: STATE.refreshToken
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.ok(data.accessToken, "Should return new access token");
        assert.notEqual(data.accessToken, STATE.accessToken, "New token should be different");

        // Update stored token
        STATE.accessToken = data.accessToken;
    })) passed++; else failed++;

    // ----------------------------------------------------
    // SCENARIO 2: CORE CRUD
    // ----------------------------------------------------

    const TEST_ENTRY = {
        id: "qa-entry-1",
        date: "2023-10-01",
        title: "Test Transaction",
        type: "saham",
        amount: 1000000,
        reason: "Initial QA Test",
        highlight: false,
        pinned: true,
        imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", // 1x1 pixel
        timestamp: Date.now()
    };

    if (await runStep("2.1 Create Valid Entry", async () => {
        const res = await worker.fetch(request('POST', '/api/entries', TEST_ENTRY, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.id, TEST_ENTRY.id);
    })) passed++; else failed++;

    if (await runStep("2.2 Validate Input Limits (Fail Case)", async () => {
        const BAD_ENTRY = { ...TEST_ENTRY, id: "qa-entry-2", title: "A".repeat(201) }; // Title too long
        const res = await worker.fetch(request('POST', '/api/entries', BAD_ENTRY, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 400);
    })) passed++; else failed++;

    if (await runStep("2.3 Read All Entries", async () => {
        const res = await worker.fetch(request('GET', '/api/entries', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.ok(data.data.length >= 1, "Should have at least 1 entry");
        assert.equal(data.data[0].title, TEST_ENTRY.title);
    })) passed++; else failed++;

    if (await runStep("2.4 Read Entry Image", async () => {
        const res = await worker.fetch(request('GET', `/api/entries/${TEST_ENTRY.id}/image`, null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.equal(data.imageData, TEST_ENTRY.imageData);
    })) passed++; else failed++;

    // ----------------------------------------------------
    // SCENARIO 3: SECURITY
    // ----------------------------------------------------

    if (await runStep("3.1 Rate Limiter (Simulate DoS)", async () => {
        // Clear limiter for clean slate
        if (globalThis.rateLimiter) globalThis.rateLimiter.clear();

        let hitLimit = false;
        // Limit is 100 per min. Loop 105 times.
        for (let i = 0; i < 105; i++) {
            const res = await worker.fetch(request('GET', '/api/health'), env, ctx);
            if (res.status === 429) {
                hitLimit = true;
                break;
            }
        }
        assert.ok(hitLimit, "Should have hit rate limit (HTTP 429)");

        // RESET LIMITER AT END
        if (globalThis.rateLimiter) globalThis.rateLimiter.clear();
    })) passed++; else failed++;

    if (await runStep("3.2 Logout All Devices", async () => {
        const res = await worker.fetch(request('POST', '/api/auth/logout-all', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 200);
    })) passed++; else failed++;

    if (await runStep("3.3 Verify Token Revocation", async () => {
        // Try to access entries with OLD token (should fail)
        const res = await worker.fetch(request('GET', '/api/entries', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 401, "Old token should be rejected");

        // Try to refresh with OLD refresh token (should fail)
        const res2 = await worker.fetch(request('POST', '/api/auth/refresh', {
            refreshToken: STATE.refreshToken
        }), env, ctx);
        assert.equal(res2.status, 401, "Old refresh token should be rejected");
    })) passed++; else failed++;

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log(`\n=========================================`);
    console.log(`🏁 QA SUITE COMPLETE`);
    console.log(`✅ PASSED: ${passed}`);
    console.log(`❌ FAILED: ${failed}`);
    console.log(`=========================================`);

    if (failed > 0) process.exit(1);
}

runQASuite();
