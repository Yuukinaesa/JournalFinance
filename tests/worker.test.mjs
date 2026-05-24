
import worker from '../backend/worker.js';
import assert from 'node:assert/strict';

// Polyfill for Cloudflare specifics if missing in Node
if (!globalThis.Response) {
    throw new Error("Node.js version too old. Please use Node 18+");
}

class MockD1Result {
    constructor(data = [], meta = { last_row_id: 1 }) {
        this.results = data;
        this.meta = meta;
    }
}

class MockD1PreparedStatement {
    constructor(db, sql) {
        this.db = db;
        this.sql = sql;
        this.bindings = [];
    }
    bind(...args) {
        this.bindings = args;
        return this;
    }
    async first() {
        return this.db._execute(this.sql, this.bindings, 'first');
    }
    async all() {
        return this.db._execute(this.sql, this.bindings, 'all');
    }
    async run() {
        return this.db._execute(this.sql, this.bindings, 'run');
    }
}

class MockD1Database {
    constructor() {
        this.users = [];
        this.entries = [];
        this.lastId = 0;
    }

    prepare(query) {
        return new MockD1PreparedStatement(this, query);
    }

    async batch(stmts) {
        for (const stmt of stmts) {
            await stmt.run();
        }
    }

    _execute(sql, bindings, mode) {
        // Simple mock logic for SELECT, INSERT, DELETE
        // This is a simplified in-memory DB for testing logic flow

        let result = null;

        if (sql.includes('INSERT INTO users')) {
            const [email, username, password_hash] = bindings;
            const id = ++this.lastId;
            const newUser = { id, email, username, password_hash, token_version: 1 };
            this.users.push(newUser);
            result = { meta: { last_row_id: id } };
        }
        else if (sql.includes('SELECT id FROM users WHERE username')) {
            const [username] = bindings;
            const user = this.users.find(u => u.username === username);
            result = mode === 'first' ? user : { results: [user].filter(Boolean) };
        }
        else if (sql.includes('SELECT * FROM users WHERE email')) {
            const [email] = bindings;
            const user = this.users.find(u => u.email === email);
            result = mode === 'first' ? user : { results: [user].filter(Boolean) };
        }
        else if (sql.includes('FROM users WHERE id')) {
            const [id] = bindings;
            const user = this.users.find(u => u.id === id);
            result = mode === 'first' ? user : { results: [user].filter(Boolean) };
        }
        else if (sql.includes('INSERT OR IGNORE INTO entries')) {
            // Mock entry insert
            const id = bindings[0];
            this.entries.push({ id, user_id: bindings[1], date: bindings[2], title: bindings[3] });
            result = { success: true };
        }
        else if (sql.includes('SELECT id, user_id, date')) {
            const [userId] = bindings;
            const userEntries = this.entries.filter(e => e.user_id === userId);
            result = { results: userEntries };
        }

        // Return based on mode
        if (mode === 'first') return result;
        if (mode === 'all') return result.results ? result : { results: [] };
        return result || { meta: { changes: 1 } };
    }
}

// SETUP ENV
const env = {
    DB: new MockD1Database(),
    JWT_SECRET: 'test-secret-key-123',
    ASSETS: {
        fetch: async () => new Response("Asset found", { status: 200 })
    }
};

const ctx = {
    waitUntil: () => { },
    passThroughOnException: () => { }
};

// HELPER TO CREATE REQUEST
function createRequest(method, path, body = null, headers = {}) {
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

// TESTS
async function runTests() {
    console.log("🚀 Starting JournalFinance Tests...\n");
    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            process.stdout.write(`Testing: ${name} ... `);
            await fn();
            console.log("✅ PASS");
            passed++;
        } catch (e) {
            console.log("❌ FAIL");
            console.error(e);
            failed++;
        }
    }

    // 1. AUTH REGISTER
    await test("Register New User", async () => {
        const req = createRequest('POST', '/api/auth/register', {
            email: "test@example.com",
            password: "password123",
            username: "tester"
        });
        const res = await worker.fetch(req, env, ctx);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.success);
        assert.ok(data.userId);
    });

    // 2. AUTH LOGIN
    await test("Login User", async () => {
        const req = createRequest('POST', '/api/auth/login', {
            email: "test@example.com",
            password: "password123"
        });
        const res = await worker.fetch(req, env, ctx);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.success);
        assert.ok(data.token);

        // Save token for next tests
        globalThis.authToken = data.token;
    });

    // 3. AUTH FAIL
    await test("Login Invalid Password", async () => {
        const req = createRequest('POST', '/api/auth/login', {
            email: "test@example.com",
            password: "wrongpassword"
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 401);
    });

    // 4. PROTECTED ROUTE (NO TOKEN)
    await test("Access Protected Route without Token", async () => {
        const req = createRequest('GET', '/api/entries');
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 401);
    });

    // 5. PROTECTED ROUTE (WITH TOKEN)
    await test("Access Protected Route with Token", async () => {
        const req = createRequest('GET', '/api/entries', null, {
            'Authorization': `Bearer ${globalThis.authToken}`
        });
        const res = await worker.fetch(req, env, ctx);
        const data = await res.json();

        assert.equal(res.status, 200);
        assert.ok(data.success);
        assert.ok(Array.isArray(data.data)); // "results" mapped to "data" in worker
    });

    // 6. RATE LIMITING
    await test("Rate Limiting", async () => {
        // Reset limiter for this IP
        if (globalThis.rateLimiter) globalThis.rateLimiter.clear();

        const ip = '1.2.3.4';
        const headers = { 'CF-Connecting-IP': ip };

        // Hit 105 times
        let blocked = false;
        for (let i = 0; i < 105; i++) {
            const req = createRequest('GET', '/api/health', null, headers);
            const res = await worker.fetch(req, env, ctx);
            if (res.status === 429) {
                blocked = true;
                break;
            }
        }
        assert.ok(blocked, "Should eventually return 429 Too Many Requests");
    });

    console.log(`\n🎉 Tests Completed: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) process.exit(1);
}

runTests();
