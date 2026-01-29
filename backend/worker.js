/**
 * Cloudflare Worker Backend for JournalFinance
 * SERVING API + STATIC ASSETS (Hybrid Mode)
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // CORS Headers - MUST be defined FIRST before any usage
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY'
        };

        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // --- SECURITY: RATE LIMITING (Memory-based for Hot Isolate) ---
        // 100 requests per minute per IP
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        const currentTime = Date.now();

        if (!globalThis.rateLimiter) globalThis.rateLimiter = new Map();
        const limiter = globalThis.rateLimiter;

        const limitData = limiter.get(clientIp) || { count: 0, lastReset: currentTime };

        // Reset every 60 seconds
        if (currentTime - limitData.lastReset > 60000) {
            limitData.count = 0;
            limitData.lastReset = currentTime;
        }

        limitData.count++;
        limiter.set(clientIp, limitData);

        if (limitData.count > 100) {
            return new Response(JSON.stringify({ error: 'Too Many Requests (Rate Limit Exceeded)' }), {
                status: 429,
                headers: corsHeaders
            });
        }
        // -----------------------------------------------------------

        try {
            // 1. API ROUTES
            if (path.startsWith('/api/')) {
                // Health Check (for ConnectionMonitor)
                if (path === '/api/health' && method === 'GET') {
                    return new Response(JSON.stringify({
                        status: 'ok',
                        timestamp: Date.now(),
                        version: '2.1.0'
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                // Auth Routes
                if (path === '/api/auth/register' && method === 'POST') return await this.register(request, env, corsHeaders);
                if (path === '/api/auth/login' && method === 'POST') return await this.login(request, env, corsHeaders);
                if (path === '/api/auth/logout-all' && method === 'POST') {
                    const user = await this.verifyAuth(request, env);
                    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

                    // Increment token version
                    await env.DB.prepare('UPDATE users SET token_version = IFNULL(token_version, 1) + 1 WHERE id = ?').bind(user.id).run();
                    return new Response(JSON.stringify({ success: true, message: 'All sessions invalidated' }), { headers: corsHeaders });
                }

                // Protected Data Routes
                if (path.startsWith('/api/data') || path.startsWith('/api/entries')) {
                    const user = await this.verifyAuth(request, env);
                    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

                    // 1. GET ALL ENTRIES (Lightweight - No Images)
                    if (path === '/api/entries' && method === 'GET') {
                        // Select everything EXCEPT image_data to save bandwidth
                        const { results } = await env.DB.prepare('SELECT id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, timestamp, last_synced FROM entries WHERE user_id = ? ORDER BY date DESC, timestamp DESC').bind(user.id).all();

                        const normalized = results.map(e => ({
                            ...e,
                            highlight: !!e.highlight,
                            pinned: !!e.pinned,
                            hasImage: !!e.has_image
                        }));
                        return new Response(JSON.stringify({ success: true, data: normalized }), { headers: corsHeaders });
                    }

                    // 2. GET SINGLE ENTRY / IMAGE
                    // Pattern: /api/entries/IMAGE_ID/image
                    if (path.match(/\/api\/entries\/[^\/]+\/image/) && method === 'GET') {
                        const entryId = path.split('/')[3]; // /api/entries/ID/image
                        const entry = await env.DB.prepare('SELECT image_data FROM entries WHERE id = ? AND user_id = ?').bind(entryId, user.id).first();

                        if (entry && entry.image_data) {
                            return new Response(JSON.stringify({ success: true, imageData: entry.image_data }), { headers: corsHeaders });
                        }
                        return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404, headers: corsHeaders });
                    }

                    // 3. CREATE / UPDATE ENTRY (Upsert)
                    if (path === '/api/entries' && method === 'POST') {
                        const e = await request.json();

                        // If image_data is NOT provided, we should probably keep existing if it exists, or handle it carefully.
                        // However, for simplicity in this full-cloud migration: expecting full payload for save.
                        // But wait, if we edit text only, we don't want to re-upload image.
                        // Logic: check if imageData is present in payload.

                        let query;
                        let args;

                        const exists = await env.DB.prepare('SELECT id, image_data FROM entries WHERE id = ? AND user_id = ?').bind(e.id, user.id).first();

                        const imageDataToSave = (e.imageData !== undefined) ? e.imageData : (exists ? exists.image_data : null);

                        await env.DB.batch([
                            env.DB.prepare(`
                                INSERT OR IGNORE INTO entries (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).bind(
                                e.id, user.id, e.date, e.title, e.type, e.amount || 0, e.reason || '',
                                e.highlight ? 1 : 0, e.pinned ? 1 : 0, e.hasImage ? 1 : 0, imageDataToSave, e.timestamp
                            ),
                            env.DB.prepare(`
                                UPDATE entries SET
                                date=?, title=?, type=?, amount=?, reason=?, 
                                highlight=?, pinned=?, has_image=?, image_data=?, timestamp=?
                                WHERE id = ? AND user_id = ?
                            `).bind(
                                e.date, e.title, e.type, e.amount || 0, e.reason || '',
                                e.highlight ? 1 : 0, e.pinned ? 1 : 0, e.hasImage ? 1 : 0, imageDataToSave, e.timestamp,
                                e.id, user.id
                            )
                        ]);

                        return new Response(JSON.stringify({ success: true, id: e.id }), { headers: corsHeaders });
                    }

                    // 4. DELETE ENTRY
                    if (path.startsWith('/api/entries/') && method === 'DELETE') {
                        const entryId = path.split('/')[3];
                        await env.DB.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').bind(entryId, user.id).run();
                        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
                    }

                    // Legacy / Bulk Utils
                    if (path === '/api/data/reset' && method === 'DELETE') return await this.resetData(request, env, user, corsHeaders);

                    // Keep Sync for now as a "Bulk Import"? Or just redirect usage.
                    if (path === '/api/data/sync' && method === 'POST') return await this.syncData(request, env, user, corsHeaders);
                }

                return new Response(JSON.stringify({ error: 'API Endpoint Not Found' }), { status: 404, headers: corsHeaders });
            }

            // 2. STATIC ASSETS (Frontend)
            // Cloudflare Assets binding automatically handles file serving
            // If the request matches a file in 'public/', serve it.
            // If not, serve 404.html for SPA fallback (or just let it 404).

            try {
                // Determine if we need to serve index.html for root
                if (path === '/') {
                    // Fetch /index.html explicitly from assets
                    // Note: usually env.ASSETS.fetch(request) handles directory index automatically
                }

                const asset = await env.ASSETS.fetch(request);

                if (asset.status === 404) {
                    // Try to serve 404.html from assets if missing
                    const notFound = await env.ASSETS.fetch(new URL('/404.html', request.url));
                    if (notFound.status === 200) return notFound;
                }

                return asset;

            } catch (e) {
                // Fallback if Asset binding fails
                return new Response('System Error: ' + e.message, { status: 500 });
            }

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
        }
    },

    // --- AUTH LOGIC (Same as before) ---

    async register(request, env, headers) {
        const { email, username, password } = await request.json();

        // INPUT VALIDATION - SECURITY CRITICAL
        if (!email || !password) {
            return new Response(JSON.stringify({ error: 'Email and Password required' }), { status: 400, headers });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email) || email.length > 255) {
            return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers });
        }

        // Username validation (Optional)
        if (username) {
            const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
            if (!usernameRegex.test(username)) {
                return new Response(JSON.stringify({ error: 'Username must be 3-30 chars, alphanumeric only' }), { status: 400, headers });
            }
        }

        // Password strength validation
        if (password.length < 8 || password.length > 128) {
            return new Response(JSON.stringify({ error: 'Password must be 8-128 characters' }), { status: 400, headers });
        }

        const passwordHash = await this.hashPassword(password);
        try {
            // Check if username already exists if provided
            if (username) {
                const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
                if (existingUser) {
                    return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 400, headers });
                }
            }

            const result = await env.DB.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
                .bind(email.toLowerCase().trim(), username || null, passwordHash)
                .run();

            return new Response(JSON.stringify({ success: true, userId: result.meta.last_row_id }), { headers });
        } catch (e) {
            if (e.message.includes('UNIQUE')) return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 400, headers });
            throw e;
        }
    },

    async login(request, env, headers) {
        const { email, password } = await request.json(); // 'email' field can now contain email OR username

        // INPUT VALIDATION
        if (!email || !password) {
            return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
        }

        const identifier = email.trim(); // Can be email or username
        let user;

        if (identifier.includes('@')) {
            // It's an email
            user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(identifier.toLowerCase()).first();
        } else {
            // It's a username (case-sensitive or insensitive? Let's go with exact match or lowercase if we enforced it. 
            // Better to assume username is stored exactly as is, but let's query carefully.
            // For now, let's assume exact match for username.)
            user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(identifier).first();
        }

        // SECURITY: Constant-time comparison to prevent timing attacks
        // Always hash password even if user not found to prevent timing-based enumeration
        const dummyHash = '0'.repeat(64); // Dummy hash for timing safety
        const hashToCompare = user ? user.password_hash : dummyHash;
        const isValid = await this.verifyPassword(password, hashToCompare);

        if (!user || !isValid) {
            return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
        }

        // ENTERPRISE SECURITY: Force use of Environment Variable
        if (!env.JWT_SECRET) {
            throw new Error('CRITICAL CONFIG ERROR: JWT_SECRET env var is missing');
        }
        const secret = env.JWT_SECRET;

        // Get current token version, default to 1 if null
        const tokenVersion = user.token_version || 1;

        const token = await this.signToken({ id: user.id, email: user.email, username: user.username, v: tokenVersion }, secret);
        return new Response(JSON.stringify({ success: true, token, user: { id: user.id, email: user.email, username: user.username } }), { headers });
    },



    async syncData(request, env, user, headers) {
        const { entries } = await request.json();
        if (entries && Array.isArray(entries) && entries.length > 0) {
            const batchStmts = [];

            // Prepare Statements
            // 1. Try Insert (Safe)
            const insertStmt = env.DB.prepare(`
                INSERT OR IGNORE INTO entries (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // 2. Update ONLY if owned by user
            const updateStmt = env.DB.prepare(`
                UPDATE entries SET
                date=?, title=?, type=?, amount=?, reason=?, 
                highlight=?, pinned=?, has_image=?, 
                image_data=?, timestamp=?
                WHERE id = ? AND user_id = ?
            `);

            for (const e of entries) {
                const amount = e.amount || 0;
                const reason = e.reason || '';
                const highlight = e.highlight ? 1 : 0;
                const pinned = e.pinned ? 1 : 0;
                const hasImage = e.hasImage ? 1 : 0;
                const imageData = e.imageData || null;

                // Push Insert
                batchStmts.push(insertStmt.bind(
                    e.id, user.id, e.date, e.title, e.type,
                    amount, reason, highlight, pinned, hasImage, imageData, e.timestamp
                ));

                // Push Update
                batchStmts.push(updateStmt.bind(
                    e.date, e.title, e.type, amount, reason,
                    highlight, pinned, hasImage, imageData, e.timestamp,
                    e.id, user.id // Where Clause
                ));
            }

            // Execute Batch
            if (batchStmts.length > 0) {
                // Split into chunks if too large (D1 limit is usually high, but safe practice)
                const CHUNK_SIZE = 100; // 50 entries * 2 statements = 100
                for (let i = 0; i < batchStmts.length; i += CHUNK_SIZE) {
                    await env.DB.batch(batchStmts.slice(i, i + CHUNK_SIZE));
                }
            }
        }

        // Fetch fresh data (METADATA ONLY) to prevent huge payload crash
        // Client can fetch images lazily
        const { results } = await env.DB.prepare('SELECT id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, timestamp, last_synced FROM entries WHERE user_id = ? ORDER BY date DESC').bind(user.id).all();

        const normalized = results.map(e => ({
            ...e,
            highlight: !!e.highlight,
            pinned: !!e.pinned,
            hasImage: !!e.has_image,
            imageData: null // Explicitly null to indicate need for fetch if hasImage=true
        }));

        return new Response(JSON.stringify({ success: true, entries: normalized }), { headers });
    },

    async resetData(request, env, user, headers) {
        try {
            await env.DB.prepare('DELETE FROM entries WHERE user_id = ?').bind(user.id).run();
            return new Response(JSON.stringify({ success: true, message: 'Cloud data wiped' }), { headers });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
        }
    },

    async verifyAuth(request, env) {
        const auth = request.headers.get('Authorization');
        if (!auth || !auth.startsWith('Bearer ')) return null;
        const token = auth.split(' ')[1];

        if (!env.JWT_SECRET) {
            throw new Error('CRITICAL CONFIG ERROR: JWT_SECRET env var is missing');
        }
        const secret = env.JWT_SECRET;

        try {
            const payload = await this.verifyToken(token, secret);

            // Check Token Version against DB
            // Use SELECT * to avoid crash if token_version column is missing (migration pending)
            const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.id).first();
            if (!user) return null;

            const currentVersion = user.token_version || 1;
            // Backward compatibility: If payload has no version ('v'), accept if DB is 1 or null.
            // But if DB > 1, reject legacy tokens.
            const payloadVersion = payload.v || 0;

            // Strict check: if payload has version, it must match.
            // If payload has NO version (old token), it is valid ONLY if DB version is default (1 or null)
            if (payload.v) {
                if (payload.v !== currentVersion) return null; // Invalidated
            } else {
                // Legacy token. If user has logged out all (version > 1), this should fail.
                // Assuming starting version is 1.
                if (currentVersion > 1) return null;
            }

            return user;
        } catch (e) { return null; }
    },

    async hashPassword(password) {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async verifyPassword(password, hash) { return (await this.hashPassword(password)) === hash; },

    async signToken(payload, secret) {
        const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
        const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 7776000 }));
        const unsigned = `${header}.${body}`;
        const signature = await this.hmacSha256(unsigned, secret);
        return `${unsigned}.${signature}`;
    },

    async verifyToken(token, secret) {
        const [header, body, signature] = token.split('.');
        if (!header || !body || !signature) throw new Error('Invalid token');
        const validSignature = await this.hmacSha256(`${header}.${body}`, secret);
        if (signature !== validSignature) throw new Error('Invalid signature');
        const payload = JSON.parse(atob(body));
        if (Date.now() / 1000 > payload.exp) throw new Error('Token expired');
        return payload;
    },

    async hmacSha256(key, secret) {
        const enc = new TextEncoder();
        const algorithm = { name: "HMAC", hash: "SHA-256" };
        const keyDetails = await crypto.subtle.importKey("raw", enc.encode(secret), algorithm, false, ["sign", "verify"]);
        const signature = await crypto.subtle.sign(algorithm.name, keyDetails, enc.encode(key));
        return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
};
