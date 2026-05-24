
import worker from '../backend/worker.js';
import assert from 'node:assert/strict';

// --- MOCK ENVIRONMENT SETUP ---

if (!globalThis.Response) {
    throw new Error("Node.js version too old. Please use Node 18+");
}

globalThis.rateLimiter = new Map();
globalThis.rateLimiterLastCleanup = Date.now();

/**
 * STRICT MOCK DATABASE
 * precise emulation of Cloudflare D1 for the JournalFinance Worker schema
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

    _execute(sql, bindings, mode) {
        const lowerSql = sql.toLowerCase().trim();

        // --- USER OPERATIONS ---
        if (lowerSql.startsWith('insert into users')) {
            const [email, username, password_hash] = bindings;
            if (this.users.find(u => u.username === username)) throw new Error('UNIQUE constraint failed: users.username');
            if (this.users.find(u => u.email === email)) throw new Error('UNIQUE constraint failed: users.email');

            const id = ++this.lastId;
            const newUser = { id, email, username, password_hash, token_version: 1 };
            this.users.push(newUser);
            return { meta: { last_row_id: id } };
        }

        if (lowerSql.startsWith('select') && lowerSql.includes('from users')) {
            let user;
            if (lowerSql.includes('id =') || lowerSql.includes('id=')) {
                user = this.users.find(u => u.id === bindings[0]);
            }
            else if (lowerSql.includes('email =') || lowerSql.includes('email=')) {
                user = this.users.find(u => u.email === bindings[0]);
            }
            else if (lowerSql.includes('username =') || lowerSql.includes('username=')) {
                user = this.users.find(u => u.username === bindings[0]);
            } else if (lowerSql.includes('*')) {
                if (lowerSql.includes('email =')) user = this.users.find(u => u.email === bindings[0]);
                else if (lowerSql.includes('username =')) user = this.users.find(u => u.username === bindings[0]);
            }

            if (mode === 'first') return user || null;
            return { results: [user].filter(Boolean) };
        }

        if (lowerSql.startsWith('update users')) {
            const id = bindings[bindings.length - 1];
            const user = this.users.find(u => u.id === id);
            if (user) {
                if (lowerSql.includes('token_version')) user.token_version = (user.token_version || 1) + 1;
                if (lowerSql.includes('password_hash')) user.password_hash = bindings[0];
            }
            return { meta: { changes: 1 } };
        }

        // --- ENTRY OPERATIONS ---

        if (lowerSql.startsWith('insert or ignore into entries')) {
            const [id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp] = bindings;

            if (!this.entries.find(e => e.id === id)) {
                this.entries.push({
                    id, user_id, date, title, type, amount, reason,
                    highlight, pinned, has_image, image_data, timestamp
                });
                return { success: true };
            }
            return { success: false };
        }

        if (lowerSql.startsWith('select') && lowerSql.includes('from entries')) {
            if (lowerSql.includes('count(*)')) {
                return { results: [{ count: this.entries.length }] };
            }

            let results = this.entries;

            if (bindings.length === 2) {
                // Single Fetch
                const id = bindings[0];
                const userId = bindings[1];
                results = results.filter(e => e.id === id && e.user_id === userId);
            } else if (bindings.length === 1) {
                // List Fetch
                const userId = bindings[0];
                results = results.filter(e => e.user_id === userId);
            }

            if (mode === 'first') return results[0] || null;
            return { results };
        }

        if (lowerSql.startsWith('update entries')) {
            const userId = bindings[bindings.length - 1];
            const id = bindings[bindings.length - 2];

            const entry = this.entries.find(e => e.id === id && e.user_id === userId);
            if (entry) {
                entry.date = bindings[0];
                entry.title = bindings[1];
                entry.type = bindings[2];
                entry.amount = bindings[3];
                entry.reason = bindings[4];
                entry.highlight = bindings[5];
                entry.pinned = bindings[6];
                entry.has_image = bindings[7];
                entry.image_data = bindings[8];
                entry.timestamp = bindings[9];
            }
            return { meta: { changes: entry ? 1 : 0 } };
        }

        if (lowerSql.startsWith('delete from entries')) {
            let initialLen = this.entries.length;

            if (lowerSql.includes('where id =') || lowerSql.includes('where id=')) {
                const id = bindings[0];
                const userId = bindings[1];
                this.entries = this.entries.filter(e => !(e.id === id && e.user_id === userId));
            }
            else if (lowerSql.includes('where user_id =') || lowerSql.includes('where user_id=')) {
                const userId = bindings[0];
                this.entries = this.entries.filter(e => e.user_id !== userId);
            }
            return { meta: { changes: initialLen - this.entries.length } };
        }

        return { meta: { changes: 0 } };
    }
}

class MockStatement {
    constructor(db, sql, bindings = []) {
        this.db = db;
        this.sql = sql;
        this.bindings = bindings;
    }
    bind(...args) {
        // Return NEW statement to mimic D1 immutable behavior
        return new MockStatement(this.db, this.sql, args);
    }
    async first() { return this.db._execute(this.sql, this.bindings, 'first'); }
    async all() { return this.db._execute(this.sql, this.bindings, 'all'); }
    async run() { return this.db._execute(this.sql, this.bindings, 'run'); }
}

const env = {
    DB: new MockD1Database(),
    JWT_SECRET: 'qa-strict-secret-key-888',
    ASSETS: {
        fetch: async (req) => {
            if (req.url.endsWith('404.html')) return new Response("404 Page", { status: 200 });
            return new Response("Static Asset Content", {
                status: 200, headers: { 'Content-Type': 'text/plain' }
            });
        }
    },
    ALLOWED_ORIGIN: 'https://qa.journalfinance.com'
};

const ctx = {
    waitUntil: () => { },
    passThroughOnException: () => { }
};

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

function log(msg) {
    process.stdout.write(msg);
}

async function runStep(name, fn) {
    const start = Date.now();
    log(`🔹 [QA] ${name.padEnd(50)} `);
    try {
        await fn();
        const duration = Date.now() - start;
        console.log(`✅ PASS (${duration}ms)`);
        return true;
    } catch (e) {
        console.log(`❌ FAIL`);
        console.error("   Error:", e.message);
        if (e.expected !== undefined) {
            console.error("   Expected:", e.expected);
            console.error("   Actual:  ", e.actual);
        }
        return false;
    }
}

async function runQASuite() {
    console.log(`\n🧪 JOURNALFINANCE STRICT QA SUITE v2.0`);
    console.log(`=========================================\n`);

    let passed = 0;
    let failed = 0;
    const STATE = {};

    // --- SCENARIO 1: AUTH ---

    if (await runStep("1.1 Register User", async () => {
        const payload = { email: "qa@strict.com", username: "qastrict", password: "SuperPassword123" };
        const res = await worker.fetch(request('POST', '/api/auth/register', payload), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.ok(data.userId);
        STATE.userId = data.userId;
    })) passed++; else failed++;

    if (await runStep("1.2 Login", async () => {
        const payload = { email: "qa@strict.com", password: "SuperPassword123" };
        const res = await worker.fetch(request('POST', '/api/auth/login', payload), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.ok(data.accessToken);
        assert.ok(data.refreshToken);
        assert.ok(data.user);
        assert.equal(data.user.email, "qa@strict.com"); // Check email
        STATE.accessToken = data.accessToken;
        STATE.refreshToken = data.refreshToken;
    })) passed++; else failed++;

    if (await runStep("1.3 Token Refresh", async () => {
        // Sleep 1.1s to ensure token timestamp rotation
        await new Promise(r => setTimeout(r, 1100));

        const res = await worker.fetch(request('POST', '/api/auth/refresh', {
            refreshToken: STATE.refreshToken
        }), env, ctx);
        const data = await res.json();
        assert.equal(res.status, 200);
        assert.ok(data.accessToken);
        assert.notEqual(data.accessToken, STATE.accessToken);
        STATE.accessToken = data.accessToken;
    })) passed++; else failed++;

    // --- SCENARIO 2: CRUD ---

    const ENTRY_ID = "entry_001";

    if (await runStep("2.1 Create Entry", async () => {
        const entry = {
            id: ENTRY_ID,
            date: "2023-12-01",
            title: "Strict Test Stock",
            type: "saham",
            amount: 1500000,
            reason: "Investment safe",
            highlight: true,
            pinned: false,
            timestamp: Date.now()
        };
        const res = await worker.fetch(request('POST', '/api/entries', entry, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 200);
    })) passed++; else failed++;

    if (await runStep("2.2 Validate Limits", async () => {
        const badType = { id: "bad_1", date: "2023-12-01", title: "Fail", type: "invalid_type", amount: 100 };
        const res1 = await worker.fetch(request('POST', '/api/entries', badType, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res1.status, 400);
    })) passed++; else failed++;

    if (await runStep("2.3 Update Entry & Read", async () => {
        const updatePayload = {
            id: ENTRY_ID,
            date: "2023-12-02",
            title: "Strict Test Stock UPDATED",
            type: "saham",
            amount: 2000000,
            reason: "More investment",
            highlight: false,
            pinned: true,
            timestamp: Date.now()
        };
        const res = await worker.fetch(request('POST', '/api/entries', updatePayload, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 200);

        const getRes = await worker.fetch(request('GET', '/api/entries', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        const list = await getRes.json();
        const item = list.data.find(e => e.id === ENTRY_ID);

        if (!item) throw new Error(`Item ${ENTRY_ID} not found`);
        assert.equal(item.title, "Strict Test Stock UPDATED");
        assert.equal(item.pinned, true);
    })) passed++; else failed++;

    if (await runStep("2.4 Delete Entry", async () => {
        const res = await worker.fetch(request('DELETE', `/api/entries/${ENTRY_ID}`, null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 200);

        const getRes = await worker.fetch(request('GET', '/api/entries', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        const list = await getRes.json();
        const item = list.data.find(e => e.id === ENTRY_ID);
        assert.equal(item, undefined);
    })) passed++; else failed++;

    // --- SCENARIO 3: SYNC ---

    if (await runStep("3.1 Bulk Sync", async () => {
        const bulkData = {
            entries: [
                { id: "sync_1", date: "2024-01-01", title: "Sync Item 1", type: "saham", amount: 500, timestamp: Date.now() },
                { id: "sync_2", date: "2024-01-01", title: "Sync Item 2", type: "barang", amount: 100, timestamp: Date.now() }
            ]
        };
        const res = await worker.fetch(request('POST', '/api/data/sync', bulkData, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.entries.length >= 2, `Expected 2+ entries, got ${data.entries?.length}`);
    })) passed++; else failed++;

    if (await runStep("3.2 Reset Data", async () => {
        const res = await worker.fetch(request('DELETE', '/api/data/reset', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        assert.equal(res.status, 200);

        const getRes = await worker.fetch(request('GET', '/api/entries', null, {
            'Authorization': `Bearer ${STATE.accessToken}`
        }), env, ctx);
        const list = await getRes.json();
        assert.equal(list.data.length, 0);
    })) passed++; else failed++;

    // --- SCENARIO 4: SECURITY ---

    if (await runStep("4.1 Security Headers", async () => {
        const res = await worker.fetch(request('GET', '/style.css'), env, ctx);
        assert.equal(res.status, 200);
        assert.ok(res.headers.get('Cache-Control').includes('no-store'));
    })) passed++; else failed++;

    if (await runStep("4.2 CORS", async () => {
        const originReq = new Request('http://localhost/api/entries', {
            method: 'OPTIONS',
            headers: { 'Origin': 'https://qa.journalfinance.com' }
        });
        const res = await worker.fetch(originReq, env, ctx);
        assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://qa.journalfinance.com');
        assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    })) passed++; else failed++;

    if (await runStep("4.3 Rate Limiter", async () => {
        if (globalThis.rateLimiter) globalThis.rateLimiter.clear();
        let blocked = false;
        for (let i = 0; i < 105; i++) {
            const res = await worker.fetch(request('GET', '/api/health'), env, ctx);
            if (res.status === 429) { blocked = true; break; }
        }
        assert.ok(blocked);
    })) passed++; else failed++;

    if (await runStep("4.4 Malformed JSON Payload", async () => {
        if (globalThis.rateLimiter) globalThis.rateLimiter.clear();
        if (globalThis.authRateLimiter) globalThis.authRateLimiter.clear();
        const req = new Request('http://localhost/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'CF-Connecting-IP': '127.0.0.1'
            },
            body: '{invalid-json: "malformed"}'
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.error, 'Malformed JSON payload');
    })) passed++; else failed++;

    // --- SUMMARY ---
    console.log(`\n=========================================`);
    console.log(`🏁 TEST COMPLETE`);
    console.log(`✅ PASSED: ${passed}`);
    console.log(`❌ FAILED: ${failed}`);
    console.log(`=========================================`);

    if (failed > 0) process.exit(1);
    else process.exit(0);
}

runQASuite();
