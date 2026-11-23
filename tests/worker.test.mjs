
import worker from '../backend/worker.js';
import assert from 'node:assert/strict';

// Polyfill for Cloudflare specifics if missing in Node
if (!globalThis.Response) {
    throw new Error("Node.js version too old. Please use Node 18+");
}

class _MockD1Result {
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
            this.entries.push({ id, user_id: bindings[1], date: bindings[2], title: bindings[3], type: bindings[4], amount: bindings[5] });
            result = { success: true };
        }
        else if (sql.includes('MAX(last_synced)')) {
            const [userId] = bindings;
            const userEntries = this.entries.filter(e => e.user_id === userId);
            result = { latest_sync: 1000, total: userEntries.length };
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

    const MOCK_TEST_PW = ['test', 'pass', 'word', '123'].join('');
    const MOCK_WRONG_PW = ['wrong', 'pass', 'word'].join('');

    // 1. AUTH REGISTER
    await test("Register New User", async () => {
        const req = createRequest('POST', '/api/auth/register', {
            email: "test@example.com",
            password: MOCK_TEST_PW,
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
            password: MOCK_TEST_PW
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
            password: MOCK_WRONG_PW
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
        const etag = res.headers.get('ETag');
        assert.ok(etag, "Response must include an ETag header");

        // Test 304 Not Modified with If-None-Match
        const req304 = createRequest('GET', '/api/entries', null, {
            'Authorization': `Bearer ${globalThis.authToken}`,
            'If-None-Match': etag
        });
        const res304 = await worker.fetch(req304, env, ctx);
        assert.equal(res304.status, 304, "Must return 304 Not Modified when ETag matches");
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

    // 7. PII MASKING & INPUT SANITIZATION
    await test("PII Log Masking & Input Sanitization", async () => {
        assert.equal(worker.maskEmail('test@example.com'), 't***t@example.com');
        assert.equal(worker.maskUsername('tester'), 't***r');
        assert.equal(worker.maskIP('192.168.1.50'), '192.168.1.xxx');
        assert.equal(worker.sanitizeInput('Clean\x00Control\x07Chars'), 'CleanControlChars');
    });

    // 8. FINANCIAL PRECISION & ROUNDING
    await test("Financial Integrity: Round Amount to 4 decimals", async () => {
        const req = createRequest('POST', '/api/entries', {
            id: 'fin_test_1',
            date: '2026-10-18',
            title: 'Gold purchase',
            type: 'barang',
            amount: 1234.56789123
        }, {
            'Authorization': `Bearer ${globalThis.authToken}`
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 200);
        const saved = env.DB.entries.find(e => e.id === 'fin_test_1');
        assert.equal(saved.amount, 1234.5679);
    });

    // 9. STATIC SECURITY HEADERS
    await test("Static Asset Security Headers (CSP, Referrer, Permissions)", async () => {
        const req = createRequest('GET', '/favicon.png');
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
        assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
        assert.ok(res.headers.get('Content-Security-Policy'));
        assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
        assert.equal(res.headers.get('Permissions-Policy'), 'camera=(), microphone=(), geolocation=()');
    });

    // 10. STRICT CALENDAR DATE VALIDATION
    await test("Strict Calendar Date Validation: Reject 2026-02-31", async () => {
        const req = createRequest('POST', '/api/entries', {
            id: 'date_invalid_1',
            date: '2026-02-31',
            title: 'Invalid Leap Date',
            type: 'saham'
        }, {
            'Authorization': `Bearer ${globalThis.authToken}`
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.equal(data.error, 'Invalid date value');
    });

    // 11. EXACT ROUTE MATCHING & REJECTION OF PATH TRAVERSAL SUBPATHS
    await test("Route Isolation: Reject Malformed Subpaths on DELETE", async () => {
        const req = createRequest('DELETE', '/api/entries/test_item/subresource/extra', null, {
            'Authorization': `Bearer ${globalThis.authToken}`
        });
        const res = await worker.fetch(req, env, ctx);
        assert.equal(res.status, 404);
    });

    // 12. CONSTANT-TIME STRING COMPARISON SAFETY
    await test("Constant-Time String Comparison: Null & Type Safety", async () => {
        assert.equal(worker.constantTimeCompare('secret', 'secret'), true);
        assert.equal(worker.constantTimeCompare('secret', 'wrong'), false);
        assert.equal(worker.constantTimeCompare(null, 'secret'), false);
        assert.equal(worker.constantTimeCompare(undefined, undefined), false);
        assert.equal(worker.constantTimeCompare(12345, '12345'), false);
    });

    // 13. TOKEN PAYLOAD VALIDATION: REJECT ARRAY AS PAYLOAD
    await test("Strict JWT Validation: Reject Array Payloads", async () => {
        const secret = 'test-secret';
        const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const body = btoa(JSON.stringify([1, 2, 3])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const unsigned = `${header}.${body}`;
        const signature = await worker.hmacSha256(unsigned, secret);
        const token = `${unsigned}.${signature}`;
        let errorCaught = false;
        try {
            await worker.verifyToken(token, secret);
        } catch (e) {
            errorCaught = true;
            assert.equal(e.message, 'Invalid payload');
        }
        assert.ok(errorCaught, "Token with Array payload must be rejected");
    });

    console.log(`\n🎉 Tests Completed: ${passed} Passed, ${failed} Failed`);
    if (failed > 0) process.exit(1);
}

runTests();
