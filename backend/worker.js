/**
 * Cloudflare Worker Backend for JournalFinance
 * SERVING API + STATIC ASSETS (Hybrid Mode)
 */

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // CORS Headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // 1. API ROUTES
            if (path.startsWith('/api/')) {
                // Auth Routes
                if (path === '/api/auth/register' && method === 'POST') return await this.register(request, env, corsHeaders);
                if (path === '/api/auth/login' && method === 'POST') return await this.login(request, env, corsHeaders);

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

                        await env.DB.prepare(`
                            INSERT INTO entries (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(id) DO UPDATE SET
                            date=excluded.date, title=excluded.title, type=excluded.type, amount=excluded.amount, 
                            reason=excluded.reason, highlight=excluded.highlight, pinned=excluded.pinned, 
                            has_image=excluded.has_image, image_data=excluded.image_data, timestamp=excluded.timestamp
                        `).bind(
                            e.id, user.id, e.date, e.title, e.type, e.amount || 0, e.reason || '',
                            e.highlight ? 1 : 0, e.pinned ? 1 : 0, e.hasImage ? 1 : 0, imageDataToSave, e.timestamp
                        ).run();

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
        const { email, password } = await request.json();
        if (!email || !password) throw new Error('Email and Password required');
        const passwordHash = await this.hashPassword(password);
        try {
            const result = await env.DB.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').bind(email, passwordHash).run();
            return new Response(JSON.stringify({ success: true, userId: result.meta.last_row_id }), { headers });
        } catch (e) {
            if (e.message.includes('UNIQUE')) return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 400, headers });
            throw e;
        }
    },

    async login(request, env, headers) {
        const { email, password } = await request.json();
        const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
        if (!user) return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
        const isValid = await this.verifyPassword(password, user.password_hash);
        if (!isValid) return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });

        // USE FALLBACK SECRET IF ENV IS MISSING (For Quick Start / Dev)
        // ideally set this in Cloudflare Dashboard -> Settings -> Variables
        // ENTERPRISE SECURITY: Force use of Environment Variable
        if (!env.JWT_SECRET) {
            throw new Error('CRITICAL CONFIG ERROR: JWT_SECRET env var is missing');
        }
        const secret = env.JWT_SECRET;

        const token = await this.signToken({ id: user.id, email: user.email }, secret);
        return new Response(JSON.stringify({ success: true, token, user: { id: user.id, email: user.email } }), { headers });
    },



    async syncData(request, env, user, headers) {
        const { entries } = await request.json();
        if (entries && Array.isArray(entries) && entries.length > 0) {
            const stmt = env.DB.prepare(`
            INSERT INTO entries (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
            date=excluded.date, title=excluded.title, type=excluded.type, amount=excluded.amount, reason=excluded.reason, 
            highlight=excluded.highlight, pinned=excluded.pinned, has_image=excluded.has_image, 
            image_data=excluded.image_data, timestamp=excluded.timestamp
        `);
            // Batch execution
            const batch = entries.map(e => stmt.bind(
                e.id,
                user.id,
                e.date,
                e.title,
                e.type,
                e.amount || 0, // Ensure amount is handled
                e.reason || '',
                e.highlight ? 1 : 0,
                e.pinned ? 1 : 0,
                e.hasImage ? 1 : 0,
                e.imageData || null, // Handle Base64 Image
                e.timestamp
            ));

            // Only execute batch if there are items
            if (batch.length > 0) {
                await env.DB.batch(batch);
            }
        }

        // Fetch fresh data including images
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

        // ENTERPRISE SECURITY: Force use of Environment Variable
        if (!env.JWT_SECRET) {
            throw new Error('CRITICAL CONFIG ERROR: JWT_SECRET env var is missing');
        }
        const secret = env.JWT_SECRET;

        try { return await this.verifyToken(token, secret); } catch (e) { return null; }
    },

    async hashPassword(password) {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async verifyPassword(password, hash) { return (await this.hashPassword(password)) === hash; },

    async signToken(payload, secret) {
        const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
        const body = btoa(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 86400 }));
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
