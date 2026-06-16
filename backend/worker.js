/**
 * Cloudflare Worker Backend for JournalFinance
 * SERVING API + STATIC ASSETS (Hybrid Mode)
 */

// ============================================================
// CONFIGURATION CONSTANTS
// ============================================================
const CONSTANTS = {
    // Rate Limiting
    RATE_LIMIT_MAX_REQUESTS: 100,           // Max requests per window
    RATE_LIMIT_WINDOW_MS: 60000,            // 60 seconds
    RATE_LIMIT_CLEANUP_INTERVAL_MS: 300000, // 5 minutes
    RATE_LIMIT_MAX_IPS: 1000,               // Max IPs to track
    RATE_LIMIT_EVICTION_PERCENT: 0.2,       // Evict 20% when full

    // JWT Token Expiration
    JWT_ACCESS_TOKEN_EXPIRE_SEC: 900,       // 15 minutes (short-lived for security)
    JWT_REFRESH_TOKEN_EXPIRE_SEC: 7776000,  // 90 days (long-lived for UX)

    // Password Security
    PBKDF2_ITERATIONS: 100000,              // OWASP minimum
    PBKDF2_KEY_LENGTH: 256,                 // 256 bits
    PBKDF2_SALT_LENGTH: 16,                 // 16 bytes (128 bits)

    // Validation Limits
    MAX_ENTRY_ID_LENGTH: 50,
    MAX_TITLE_LENGTH: 200,
    MAX_REASON_LENGTH: 5000,
    MAX_EMAIL_LENGTH: 255,
    MAX_PASSWORD_LENGTH: 128,
    MIN_PASSWORD_LENGTH: 8,
    MAX_USERNAME_LENGTH: 30,
    MIN_USERNAME_LENGTH: 3,
    MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
    MAX_AMOUNT_VALUE: 1e12,                  // 1 trillion
    MIN_AMOUNT_VALUE: -1e12,
    MAX_FUTURE_TIMESTAMP_MS: 86400000,       // 24 hours clock skew tolerance
};

export default {
    async fetch(request, env, _ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // SECURITY: Strict CORS - Restrict to specific origins
        // In production, set env.ALLOWED_ORIGIN to your production domain
        const requestOrigin = request.headers.get('Origin');
        const allowedOrigins = [
            'https://catatan.arfan-hidayat-priyantono.workers.dev',
            'https://journal-finance.pages.dev', // If deployed to Pages
            env.ALLOWED_ORIGIN // Custom origin from environment variable
        ].filter(Boolean); // Remove undefined values

        let corsOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
            ? requestOrigin
            : allowedOrigins[0]; // Default to first allowed origin

        // For local development ONLY, allow localhost (strict check)
        if (requestOrigin && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
            if (requestOrigin === 'http://localhost:8787' || requestOrigin === 'http://127.0.0.1:8787' ||
                requestOrigin === 'http://localhost:3000' || requestOrigin === 'http://127.0.0.1:3000') {
                corsOrigin = requestOrigin;
            }
        }

        // Dynamic connect-src to support local development connections and WS/HMR
        const localConnect = (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
            ? " http://127.0.0.1:8787 ws://127.0.0.1:8787 http://localhost:8787 ws://localhost:8787 http://localhost:3000 ws://localhost:3000 http://127.0.0.1:3000 ws://127.0.0.1:3000"
            : "";
        const cspHeader = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://catatan.arfan-hidayat-priyantono.workers.dev${localConnect}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests;`;

        // CORS Headers - NOW RESTRICTED
        const corsHeaders = {
            'Access-Control-Allow-Origin': corsOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store', // SECURITY: Prevent caching of authenticated responses
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': cspHeader,
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
            'Vary': 'Origin' // Important for caching correctness
        };

        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // --- SECURITY: RATE LIMITING (Memory-based for Hot Isolate) ---
        // 100 requests per minute per IP with LRU eviction to prevent memory leak
        const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
        const currentTime = Date.now();

        if (!globalThis.rateLimiter) {
            globalThis.rateLimiter = new Map();
            globalThis.rateLimiterLastCleanup = currentTime;
        }
        const limiter = globalThis.rateLimiter;

        const limitData = limiter.get(clientIp) || { count: 0, lastReset: currentTime };

        // Reset every 60 seconds
        if (currentTime - limitData.lastReset > CONSTANTS.RATE_LIMIT_WINDOW_MS) {
            limitData.count = 0;
            limitData.lastReset = currentTime;
        }

        limitData.count++;
        limiter.set(clientIp, limitData);

        if (limitData.count > CONSTANTS.RATE_LIMIT_MAX_REQUESTS) {
            console.warn(JSON.stringify({ event: 'RATE_LIMIT_EXCEEDED', ip: clientIp, path, count: limitData.count, timestamp: currentTime }));
            return new Response(JSON.stringify({ error: 'Too Many Requests (Rate Limit Exceeded)' }), {
                status: 429,
                headers: corsHeaders
            });
        }

        // --- AUTH SPECIFIC RATE LIMITING ---
        if (path.startsWith('/api/auth/')) {
            if (!globalThis.authRateLimiter) globalThis.authRateLimiter = new Map();
            const authLimiter = globalThis.authRateLimiter;
            const authLimitData = authLimiter.get(clientIp) || { count: 0, lastReset: currentTime };
            if (currentTime - authLimitData.lastReset > 60000) { // 1 minute
                authLimitData.count = 0;
                authLimitData.lastReset = currentTime;
            }
            authLimitData.count++;
            authLimiter.set(clientIp, authLimitData);
            if (authLimitData.count > 5) { // Max 5 auth attempts per minute
                console.warn(JSON.stringify({ event: 'AUTH_RATE_LIMIT_EXCEEDED', ip: clientIp, path, count: authLimitData.count, timestamp: currentTime }));
                return new Response(JSON.stringify({ error: 'Too Many Auth Attempts. Try again later.' }), {
                    status: 429,
                    headers: corsHeaders
                });
            }
            // Secure cleanup: Evict oldest 20% of entries instead of clearing all (prevents rate-limit reset bypass)
            if (authLimiter.size > 1000) {
                const entriesToRemove = 200;
                const iterator = authLimiter.keys();
                for (let i = 0; i < entriesToRemove; i++) {
                    const key = iterator.next().value;
                    if (key) authLimiter.delete(key);
                }
            }
        }
        // -----------------------------------------------------------

        // MEMORY LEAK FIX: Periodic cleanup of old entries (every 5 minutes)
        // This prevents unbounded growth from unique IPs
        if (currentTime - globalThis.rateLimiterLastCleanup > CONSTANTS.RATE_LIMIT_CLEANUP_INTERVAL_MS) {
            const maxEntries = CONSTANTS.RATE_LIMIT_MAX_IPS; // Keep at most 1000 IPs in memory
            if (limiter.size > maxEntries) {
                // Remove oldest 20% of entries (simple LRU)
                const entriesToRemove = Math.floor(limiter.size * CONSTANTS.RATE_LIMIT_EVICTION_PERCENT);
                const iterator = limiter.keys();
                for (let i = 0; i < entriesToRemove; i++) {
                    const key = iterator.next().value;
                    if (key) limiter.delete(key);
                }
            }
            globalThis.rateLimiterLastCleanup = currentTime;
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

                // REFRESH TOKEN ENDPOINT - Get new access token using refresh token
                if (path === '/api/auth/refresh' && method === 'POST') {
                    try {
                        const { refreshToken } = await request.json();

                        if (!refreshToken) {
                            return new Response(JSON.stringify({ error: 'Refresh token required' }), {
                                status: 400,
                                headers: corsHeaders
                            });
                        }

                        if (!env.JWT_SECRET) {
                            throw new Error('JWT_SECRET not configured');
                        }

                        // Verify refresh token
                        const payload = await this.verifyToken(refreshToken, env.JWT_SECRET);

                        // Ensure it's actually a refresh token
                        if (payload.type !== 'refresh') {
                            return new Response(JSON.stringify({ error: 'Invalid token type' }), {
                                status: 403,
                                headers: corsHeaders
                            });
                        }

                        // Check token version (logout-all invalidation)
                        const user = await env.DB.prepare('SELECT id, email, username, token_version FROM users WHERE id = ?').bind(payload.id).first();
                        if (!user) {
                            return new Response(JSON.stringify({ error: 'User not found' }), {
                                status: 404,
                                headers: corsHeaders
                            });
                        }

                        const currentVersion = user.token_version || 1;
                        if (payload.v !== currentVersion) {
                            return new Response(JSON.stringify({ error: 'Token invalidated (logged out)' }), {
                                status: 401,
                                headers: corsHeaders
                            });
                        }

                        // Issue new access token + rotated refresh token
                        const newTokenPayload = {
                            id: user.id,
                            email: user.email,
                            username: user.username,
                            v: currentVersion
                        };
                        const newAccessToken = await this.signToken(newTokenPayload, env.JWT_SECRET, 'access');
                        const newRefreshToken = await this.signToken(newTokenPayload, env.JWT_SECRET, 'refresh');

                        console.log(JSON.stringify({ event: 'AUTH_REFRESH_SUCCESS', userId: user.id, email: user.email, timestamp: Date.now() }));
                        return new Response(JSON.stringify({
                            success: true,
                            accessToken: newAccessToken,
                            token: newAccessToken, // Backward compatibility
                            refreshToken: newRefreshToken, // SECURITY: Rotate refresh token
                            expiresIn: CONSTANTS.JWT_ACCESS_TOKEN_EXPIRE_SEC
                        }), { headers: corsHeaders });

                    } catch (e) {
                        console.warn(JSON.stringify({ event: 'AUTH_REFRESH_FAILED', reason: e.message, timestamp: Date.now() }));
                        return new Response(JSON.stringify({ error: 'Invalid or expired refresh token' }), {
                            status: 401,
                            headers: corsHeaders
                        });
                    }
                }

                if (path === '/api/auth/logout-all' && method === 'POST') {
                    const user = await this.verifyAuth(request, env);
                    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

                    await env.DB.prepare('UPDATE users SET token_version = IFNULL(token_version, 1) + 1 WHERE id = ?').bind(user.id).run();
                    console.log(JSON.stringify({ event: 'AUTH_LOGOUT_ALL', userId: user.id, email: user.email, timestamp: Date.now() }));
                    return new Response(JSON.stringify({ success: true, message: 'All sessions invalidated' }), { headers: corsHeaders });
                }

                // User Preferences - GET (Fetch latest from cloud)
                if (path === '/api/user/preferences' && method === 'GET') {
                    const user = await this.verifyAuth(request, env);
                    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

                    try {
                        const row = await env.DB.prepare('SELECT preferences FROM users WHERE id = ?')
                            .bind(user.id)
                            .first();

                        const preferences = row && row.preferences ? JSON.parse(row.preferences) : {};
                        return new Response(JSON.stringify({ success: true, preferences }), { headers: corsHeaders });
                    } catch {
                        return new Response(JSON.stringify({ error: 'Failed to fetch preferences' }), { status: 500, headers: corsHeaders });
                    }
                }

                // User Preferences - PUT (Update)
                if (path === '/api/user/preferences' && method === 'PUT') {
                    const user = await this.verifyAuth(request, env);
                    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

                    try {
                        const { preferences } = await request.json();
                        if (!preferences) return new Response(JSON.stringify({ error: 'Preferences required' }), { status: 400, headers: corsHeaders });

                        // Ensure it's a valid JSON string or object
                        const prefString = typeof preferences === 'string' ? preferences : JSON.stringify(preferences);

                        // SECURITY: Limit preferences size to prevent storage abuse
                        if (prefString.length > 50000) {
                            return new Response(JSON.stringify({ error: 'Preferences too large (max 50KB)' }), { status: 400, headers: corsHeaders });
                        }

                        await env.DB.prepare('UPDATE users SET preferences = ? WHERE id = ?')
                            .bind(prefString, user.id)
                            .run();

                        return new Response(JSON.stringify({ success: true, preferences: JSON.parse(prefString) }), { headers: corsHeaders });
                    } catch {
                        return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400, headers: corsHeaders });
                    }
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
                        // SECURITY: Validate entryId to prevent path traversal
                        if (!entryId || !/^[a-zA-Z0-9_-]+$/.test(entryId) || entryId.length > CONSTANTS.MAX_ENTRY_ID_LENGTH) {
                            return new Response(JSON.stringify({ error: 'Invalid entry ID' }), { status: 400, headers: corsHeaders });
                        }
                        const entry = await env.DB.prepare('SELECT image_data FROM entries WHERE id = ? AND user_id = ?').bind(entryId, user.id).first();

                        if (entry && entry.image_data) {
                            return new Response(JSON.stringify({ success: true, imageData: entry.image_data }), { headers: corsHeaders });
                        }
                        return new Response(JSON.stringify({ success: false, error: 'Not found' }), { status: 404, headers: corsHeaders });
                    }

                    // 3. CREATE / UPDATE ENTRY (Upsert) - WITH COMPREHENSIVE VALIDATION
                    if (path === '/api/entries' && method === 'POST') {
                        // SECURITY: Validate Content-Type
                        const contentType = request.headers.get('Content-Type');
                        if (!contentType || !contentType.includes('application/json')) {
                            return new Response(JSON.stringify({ error: 'Invalid Content-Type' }), { status: 400, headers: corsHeaders });
                        }

                        const e = await request.json();

                        // SECURITY & DATA INTEGRITY: Input Validation

                        // 1. ID Validation (UUID format, max 50 chars)
                        if (!e.id || typeof e.id !== 'string' || e.id.length === 0 || e.id.length > CONSTANTS.MAX_ENTRY_ID_LENGTH) {
                            return new Response(JSON.stringify({ error: 'Invalid or missing ID' }), { status: 400, headers: corsHeaders });
                        }
                        if (!/^[a-zA-Z0-9_-]+$/.test(e.id)) {
                            return new Response(JSON.stringify({ error: 'ID contains invalid characters' }), { status: 400, headers: corsHeaders });
                        }

                        // 2. Date Validation (YYYY-MM-DD)
                        if (!e.date || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) {
                            return new Response(JSON.stringify({ error: 'Invalid date format (use YYYY-MM-DD)' }), { status: 400, headers: corsHeaders });
                        }
                        const dateObj = new Date(e.date);
                        if (isNaN(dateObj.getTime())) {
                            return new Response(JSON.stringify({ error: 'Invalid date value' }), { status: 400, headers: corsHeaders });
                        }

                        // 3. Title Validation (required, max 200 chars)
                        if (!e.title || typeof e.title !== 'string' || e.title.trim().length === 0 || e.title.length > CONSTANTS.MAX_TITLE_LENGTH) {
                            return new Response(JSON.stringify({ error: `Title required (max ${CONSTANTS.MAX_TITLE_LENGTH} chars)` }), { status: 400, headers: corsHeaders });
                        }
                        const title = e.title.trim().replace(/[\x00-\x1F\x7F]/g, '');

                        // 4. Type Validation (whitelist)
                        const validTypes = ['saham', 'kripto', 'barang', 'peristiwa', 'lainnya'];
                        if (!validTypes.includes(e.type)) {
                            return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers: corsHeaders });
                        }

                        // 5. Amount Validation (number, reasonable range)
                        let amount = 0;
                        if (e.amount !== undefined && e.amount !== null) {
                            amount = parseFloat(e.amount);
                            if (isNaN(amount) || amount < CONSTANTS.MIN_AMOUNT_VALUE || amount > CONSTANTS.MAX_AMOUNT_VALUE) {
                                return new Response(JSON.stringify({ error: 'Invalid amount' }), { status: 400, headers: corsHeaders });
                            }
                        }

                        // 6. Reason Validation (max 5000 chars)
                        let reason = '';
                        if (e.reason !== undefined && e.reason !== null) {
                            if (typeof e.reason !== 'string' || e.reason.length > CONSTANTS.MAX_REASON_LENGTH) {
                                return new Response(JSON.stringify({ error: `Reason too long (max ${CONSTANTS.MAX_REASON_LENGTH})` }), { status: 400, headers: corsHeaders });
                            }
                            reason = e.reason;
                        }

                        // 7. Boolean Validation
                        const highlight = !!e.highlight;
                        const pinned = !!e.pinned;
                        const hasImage = !!e.hasImage;

                        // 8. Timestamp Validation
                        let timestamp = Date.now();
                        if (e.timestamp !== undefined && e.timestamp !== null) {
                            timestamp = parseInt(e.timestamp);
                            if (isNaN(timestamp) || timestamp < 0 || timestamp > Date.now() + CONSTANTS.MAX_FUTURE_TIMESTAMP_MS) {
                                timestamp = Date.now(); // Fallback to current time if invalid
                            }
                        }

                        // 9. Image Data Validation (base64, max ~10MB)
                        const exists = await env.DB.prepare('SELECT id, image_data FROM entries WHERE id = ? AND user_id = ?').bind(e.id, user.id).first();
                        let imageDataToSave = null;

                        if (e.imageData !== undefined) {
                            if (e.imageData !== null) {
                                if (typeof e.imageData !== 'string') {
                                    return new Response(JSON.stringify({ error: 'Invalid image data type' }), { status: 400, headers: corsHeaders });
                                }
                                if (!this.isValidBase64Image(e.imageData)) {
                                    return new Response(JSON.stringify({ error: 'Invalid image format or size' }), { status: 400, headers: corsHeaders });
                                }
                                imageDataToSave = e.imageData;
                            }
                        } else {
                            imageDataToSave = exists ? exists.image_data : null;
                        }

                        // SAVE TO DATABASE (with validated data)
                        await env.DB.batch([
                            env.DB.prepare(`
                                INSERT OR IGNORE INTO entries (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).bind(
                                e.id, user.id, e.date, title, e.type, amount, reason,
                                highlight ? 1 : 0, pinned ? 1 : 0, hasImage ? 1 : 0, imageDataToSave, timestamp
                            ),
                            env.DB.prepare(`
                                UPDATE entries SET
                                date=?, title=?, type=?, amount=?, reason=?, 
                                highlight=?, pinned=?, has_image=?, image_data=?, timestamp=?
                                WHERE id = ? AND user_id = ?
                            `).bind(
                                e.date, title, e.type, amount, reason,
                                highlight ? 1 : 0, pinned ? 1 : 0, hasImage ? 1 : 0, imageDataToSave, timestamp,
                                e.id, user.id
                            )
                        ]);

                        return new Response(JSON.stringify({ success: true, id: e.id }), { headers: corsHeaders });
                    }


                    if (path.startsWith('/api/entries/') && method === 'DELETE') {
                        const entryId = path.split('/')[3];
                        // SECURITY: Validate entryId to prevent path traversal / injection
                        if (!entryId || !/^[a-zA-Z0-9_-]+$/.test(entryId) || entryId.length > CONSTANTS.MAX_ENTRY_ID_LENGTH) {
                            return new Response(JSON.stringify({ error: 'Invalid entry ID' }), { status: 400, headers: corsHeaders });
                        }
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

                // CACHE BUSTING: Force browser to revalidate static assets
                // This ensures users always get the latest version without manual refresh
                const newHeaders = new Headers(asset.headers);
                newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
                newHeaders.set('Pragma', 'no-cache');
                newHeaders.set('Expires', '0');
                newHeaders.set('X-Content-Type-Options', 'nosniff');
                newHeaders.set('X-Frame-Options', 'DENY');
                newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

                return new Response(asset.body, {
                    status: asset.status,
                    statusText: asset.statusText,
                    headers: newHeaders
                });

            } catch (e) {
                // Fallback if Asset binding fails
                return new Response('System Error: ' + e.message, { status: 500 });
            }

        } catch (e) {
            if (e instanceof SyntaxError) {
                return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), { status: 400, headers: corsHeaders });
            }
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
        }
    },

    // --- AUTH LOGIC (Same as before) ---

    async register(request, env, headers) {
        const { email, username, password } = await request.json();

        // INPUT VALIDATION - SECURITY CRITICAL
        if (!email || !password || !username) {
            console.warn(JSON.stringify({ event: 'AUTH_REGISTER_FAILED', reason: 'Missing fields', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: 'Email, Username, and Password required' }), { status: 400, headers });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email) || email.length > CONSTANTS.MAX_EMAIL_LENGTH) {
            console.warn(JSON.stringify({ event: 'AUTH_REGISTER_FAILED', email, reason: 'Invalid email format', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400, headers });
        }

        // Username validation (Mandatory)
        const usernameRegex = new RegExp(`^[a-zA-Z0-9_]{${CONSTANTS.MIN_USERNAME_LENGTH},${CONSTANTS.MAX_USERNAME_LENGTH}}$`);
        if (!usernameRegex.test(username)) {
            console.warn(JSON.stringify({ event: 'AUTH_REGISTER_FAILED', username, reason: 'Invalid username format', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: `Username must be ${CONSTANTS.MIN_USERNAME_LENGTH}-${CONSTANTS.MAX_USERNAME_LENGTH} chars, alphanumeric only` }), { status: 400, headers });
        }

        // Password strength validation
        if (password.length < CONSTANTS.MIN_PASSWORD_LENGTH || password.length > CONSTANTS.MAX_PASSWORD_LENGTH) {
            console.warn(JSON.stringify({ event: 'AUTH_REGISTER_FAILED', email, username, reason: 'Weak or too long password', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: `Password must be ${CONSTANTS.MIN_PASSWORD_LENGTH}-${CONSTANTS.MAX_PASSWORD_LENGTH} characters` }), { status: 400, headers });
        }

        const passwordHash = await this.hashPassword(password);
        try {
            // Check if username already exists
            const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
            if (existingUser) {
                console.warn(JSON.stringify({ event: 'AUTH_REGISTER_FAILED', username, reason: 'Username already taken', timestamp: Date.now() }));
                return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 400, headers });
            }

            const result = await env.DB.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
                .bind(email.toLowerCase().trim(), username, passwordHash)
                .run();

            console.log(JSON.stringify({ event: 'AUTH_REGISTER_SUCCESS', userId: result.meta.last_row_id, email, username, timestamp: Date.now() }));
            return new Response(JSON.stringify({ success: true, userId: result.meta.last_row_id }), { headers });
        } catch (e) {
            if (e.message.includes('UNIQUE')) {
                console.warn(JSON.stringify({ event: 'AUTH_REGISTER_FAILED', email, reason: 'Email already exists', timestamp: Date.now() }));
                return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 400, headers });
            }
            throw e;
        }
    },

    async login(request, env, headers) {
        const { email, password } = await request.json(); // 'email' field can now contain email OR username

        // INPUT VALIDATION
        if (!email || !password) {
            console.warn(JSON.stringify({ event: 'AUTH_LOGIN_FAILED', reason: 'Missing credentials', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
        }

        const identifier = email.trim(); // Can be email or username
        // SECURITY: Length limit to prevent oversized DB queries
        if (identifier.length > CONSTANTS.MAX_EMAIL_LENGTH || password.length > CONSTANTS.MAX_PASSWORD_LENGTH) {
            console.warn(JSON.stringify({ event: 'AUTH_LOGIN_FAILED', identifier, reason: 'Input length exceeded limits', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
        }
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
        const dummyHash = `pbkdf2$${CONSTANTS.PBKDF2_ITERATIONS}$${'0'.repeat(32)}$${'0'.repeat(64)}`; // PBKDF2 dummy hash for timing safety
        const hashToCompare = user ? user.password_hash : dummyHash;
        const isValid = await this.verifyPassword(password, hashToCompare);

        if (!user || !isValid) {
            console.warn(JSON.stringify({ event: 'AUTH_LOGIN_FAILED', identifier, reason: 'Invalid credentials', timestamp: Date.now() }));
            return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers });
        }

        // AUTO-UPGRADE: If user has legacy SHA-256 hash, upgrade to PBKDF2
        if (isValid && !user.password_hash.startsWith('pbkdf2$')) {
            const newHash = await this.hashPassword(password);
            await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                .bind(newHash, user.id)
                .run();
            // Note: Silent upgrade, user doesn't need to know
        }

        // ENTERPRISE SECURITY: Force use of Environment Variable
        if (!env.JWT_SECRET) {
            throw new Error('CRITICAL CONFIG ERROR: JWT_SECRET env var is missing');
        }
        const secret = env.JWT_SECRET;

        // Get current token version, default to 1 if null
        const tokenVersion = user.token_version || 1;

        // Generate BOTH access and refresh tokens
        const tokenPayload = { id: user.id, email: user.email, username: user.username, v: tokenVersion };
        const accessToken = await this.signToken(tokenPayload, secret, 'access');
        const refreshToken = await this.signToken(tokenPayload, secret, 'refresh');

        console.log(JSON.stringify({ event: 'AUTH_LOGIN_SUCCESS', userId: user.id, email: user.email, username: user.username, timestamp: Date.now() }));
        return new Response(JSON.stringify({
            success: true,
            token: accessToken,        // Keep 'token' for backward compatibility
            accessToken: accessToken,  // Explicit access token
            refreshToken: refreshToken, // New: refresh token
            expiresIn: CONSTANTS.JWT_ACCESS_TOKEN_EXPIRE_SEC,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                preferences: (() => { try { return user.preferences ? JSON.parse(user.preferences) : null; } catch { return null; } })()
            }
        }), { headers });
    },



    async syncData(request, env, user, headers) {
        const body = await request.json();
        const entries = body.entries;

        // SECURITY: Validate input type
        if (entries && !Array.isArray(entries)) {
            return new Response(JSON.stringify({ error: 'Invalid entries format' }), { status: 400, headers });
        }

        // SECURITY: Limit batch size to prevent DoS
        const MAX_SYNC_BATCH = 500;
        if (entries && entries.length > MAX_SYNC_BATCH) {
            return new Response(JSON.stringify({ error: `Too many entries (max ${MAX_SYNC_BATCH})` }), { status: 400, headers });
        }

        if (entries && Array.isArray(entries) && entries.length > 0) {
            const batchStmts = [];

            // Prepare Statements
            // 1. Try Insert (Safe) - Only for NEW entries
            const insertStmt = env.DB.prepare(`
                INSERT OR IGNORE INTO entries (id, user_id, date, title, type, amount, reason, highlight, pinned, has_image, image_data, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            // 2. Update metadata ONLY (PRESERVE existing image_data)
            // BUG FIX: Previously this always set image_data=null during sync,
            // silently deleting all images. Now we only update metadata fields.
            const updateMetadataStmt = env.DB.prepare(`
                UPDATE entries SET
                date=?, title=?, type=?, amount=?, reason=?, 
                highlight=?, pinned=?, has_image=?, timestamp=?
                WHERE id = ? AND user_id = ?
            `);

            // 3. Update WITH image_data (only when explicitly provided)
            const updateWithImageStmt = env.DB.prepare(`
                UPDATE entries SET
                date=?, title=?, type=?, amount=?, reason=?, 
                highlight=?, pinned=?, has_image=?, 
                image_data=?, timestamp=?
                WHERE id = ? AND user_id = ?
            `);

            for (const e of entries) {
                // SECURITY: Basic validation to prevent DoS, NoSQL injection, or overflow on Sync
                if (!e.id || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(e.id) || e.id.length > CONSTANTS.MAX_ENTRY_ID_LENGTH) {
                    continue; // Skip invalid ID to prevent batch crash
                }

                let title = typeof e.title === 'string' ? e.title.trim().replace(/[\x00-\x1F\x7F]/g, '') : "Untitled";
                if (title.length > CONSTANTS.MAX_TITLE_LENGTH) title = title.substring(0, CONSTANTS.MAX_TITLE_LENGTH);
                if (!title) title = "Untitled";

                const dateStr = (typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) ? e.date : new Date().toISOString().slice(0, 10);
                const validTypes = ['saham', 'kripto', 'barang', 'peristiwa', 'lainnya'];
                const type = validTypes.includes(e.type) ? e.type : 'lainnya';

                let amount = parseFloat(e.amount);
                if (isNaN(amount) || amount < CONSTANTS.MIN_AMOUNT_VALUE || amount > CONSTANTS.MAX_AMOUNT_VALUE) amount = 0;

                let reason = typeof e.reason === 'string' ? e.reason : '';
                if (reason.length > CONSTANTS.MAX_REASON_LENGTH) reason = reason.substring(0, CONSTANTS.MAX_REASON_LENGTH);

                const highlight = !!e.highlight ? 1 : 0;
                const pinned = !!e.pinned ? 1 : 0;
                let hasImage = !!e.hasImage ? 1 : 0;

                let timestamp = parseInt(e.timestamp);
                if (isNaN(timestamp) || timestamp < 0 || timestamp > Date.now() + CONSTANTS.MAX_FUTURE_TIMESTAMP_MS) {
                    timestamp = Date.now();
                }

                let imageData = null;
                const hasExplicitImageData = e.imageData !== undefined && e.imageData !== null;
                if (hasExplicitImageData) {
                    if (typeof e.imageData === 'string' && this.isValidBase64Image(e.imageData)) {
                        imageData = e.imageData;
                        hasImage = 1;
                    } else {
                        // Invalid image, clear it
                        hasImage = 0;
                        imageData = null;
                    }
                }

                // Push Insert (for new entries only)
                batchStmts.push(insertStmt.bind(
                    e.id, user.id, dateStr, title, type,
                    amount, reason, highlight, pinned, hasImage, imageData, timestamp
                ));

                // Push Update - choose correct statement based on whether imageData is provided
                if (hasExplicitImageData) {
                    // Image data explicitly provided - update it
                    batchStmts.push(updateWithImageStmt.bind(
                        dateStr, title, type, amount, reason,
                        highlight, pinned, hasImage, imageData, timestamp,
                        e.id, user.id
                    ));
                } else {
                    // No image data in payload - preserve existing image_data in DB
                    batchStmts.push(updateMetadataStmt.bind(
                        dateStr, title, type, amount, reason,
                        highlight, pinned, hasImage, timestamp,
                        e.id, user.id
                    ));
                }
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

            // SECURITY: Reject refresh tokens used as bearer tokens
            // Only access tokens should be used for API authentication
            if (payload.type && payload.type !== 'access') return null;

            // Check Token Version against DB
            // Only select needed columns to prevent password hash leakage
            const user = await env.DB.prepare('SELECT id, email, username, token_version, preferences FROM users WHERE id = ?').bind(payload.id).first();
            if (!user) return null;

            const currentVersion = user.token_version || 1;
            // Backward compatibility: If payload has no version ('v'), accept if DB is 1 or null.
            // But if DB > 1, reject legacy tokens.

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
        } catch { return null; }
    },


    /**
     * SECURE PASSWORD HASHING - PBKDF2-SHA256
     * Replaces vulnerable SHA-256 with industry-standard password hashing
     * Format: pbkdf2$iterations$salt$hash
     * - 100,000 iterations (OWASP recommended minimum)
     * - Random 16-byte salt per user
     * - Resistant to rainbow tables, brute force, GPU cracking
     */
    async hashPassword(password) {
        // Generate random salt (16 bytes = 128 bits)
        const saltBuffer = crypto.getRandomValues(new Uint8Array(16));
        const salt = Array.from(saltBuffer).map(b => b.toString(16).padStart(2, '0')).join('');

        // PBKDF2 parameters (OWASP recommendations)
        const iterations = 100000; // Minimum recommended as of 2023
        const keyLength = 256; // 256 bits = 32 bytes

        // Derive key using PBKDF2
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        // SECURITY: Use raw salt bytes for full entropy (not text-encoded hex)
        const saltBytes = new Uint8Array(salt.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );

        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            keyLength
        );

        const hashArray = Array.from(new Uint8Array(derivedBits));
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Format: pbkdf2$iterations$salt$hash
        return `pbkdf2$${iterations}$${salt}$${hash}`;
    },

    /**
     * VERIFY PASSWORD with backward compatibility
     * Supports both new PBKDF2 hashes and legacy SHA-256 hashes
     * Legacy hashes will be auto-upgraded on next successful login
     */
    async verifyPassword(password, storedHash) {
        // Check if it's a PBKDF2 hash (new format)
        if (storedHash.startsWith('pbkdf2$')) {
            const parts = storedHash.split('$');
            if (parts.length !== 4) return false;

            const [, iterations, salt, hash] = parts;

            // Helper: derive PBKDF2 hash with given salt bytes
            const deriveHash = async (saltBytes) => {
                const encoder = new TextEncoder();
                const passwordBuffer = encoder.encode(password);

                const keyMaterial = await crypto.subtle.importKey(
                    'raw',
                    passwordBuffer,
                    { name: 'PBKDF2' },
                    false,
                    ['deriveBits']
                );

                const derivedBits = await crypto.subtle.deriveBits(
                    {
                        name: 'PBKDF2',
                        salt: saltBytes,
                        iterations: parseInt(iterations),
                        hash: 'SHA-256'
                    },
                    keyMaterial,
                    256
                );

                const hashArray = Array.from(new Uint8Array(derivedBits));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            };

            // Method 1: Try NEW method (raw bytes from hex) — used by new hashPassword
            const rawSaltBytes = new Uint8Array(salt.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
            const computedHashNew = await deriveHash(rawSaltBytes);

            if (this.constantTimeCompare(computedHashNew, hash)) {
                return true;
            }

            // Method 2: Fallback to OLD method (text-encoded hex string) — for existing hashes
            const encoder = new TextEncoder();
            const textSaltBytes = encoder.encode(salt);
            const computedHashOld = await deriveHash(textSaltBytes);

            return this.constantTimeCompare(computedHashOld, hash);
        }

        // LEGACY: Support old SHA-256 hashes (for migration period)
        // This allows existing users to still log in
        // Their password will be upgraded to PBKDF2 on next login (handled in login endpoint)
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const computedHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        return this.constantTimeCompare(computedHash, storedHash);
    },

    /**
     * Efficiently validate base64 image data urls in O(1) time
     * Prevents CPU-intensive regex matching on large (up to 10MB) payloads
     */
    isValidBase64Image(str) {
        if (typeof str !== 'string') return false;
        
        // Fast prefix checks
        const prefixes = [
            'data:image/jpeg;base64,',
            'data:image/jpg;base64,',
            'data:image/png;base64,',
            'data:image/webp;base64,'
        ];
        const matchingPrefix = prefixes.find(p => str.startsWith(p));
        if (!matchingPrefix) return false;

        // Size check
        if (str.length > CONSTANTS.MAX_IMAGE_SIZE_BYTES) return false;

        // Validate structure of a small subset (start and end) to prevent ReDoS on massive inputs
        const base64Part = str.slice(matchingPrefix.length);
        if (base64Part.length === 0) return false;

        // Validate first 100 characters and last 4 characters using a simple regex
        const checkPart = base64Part.slice(0, 100) + base64Part.slice(-4);
        return /^[A-Za-z0-9+/=]+$/.test(checkPart);
    },

    /**
     * Constant-time string comparison to prevent timing attacks
     */
    constantTimeCompare(a, b) {
        // SECURITY: Pad to same length to avoid leaking length via timing
        const maxLen = Math.max(a.length, b.length);
        let mismatch = a.length ^ b.length; // Non-zero if lengths differ
        for (let i = 0; i < maxLen; i++) {
            mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
        }
        return mismatch === 0;
    },


    /**
     * SIGN JWT TOKEN
     * @param {Object} payload - Data to include in token
     * @param {string} secret - Secret key for signing
     * @param {string} tokenType - 'access' or 'refresh'
     * 
     * Access tokens: 90 days (7776000 seconds)
     * Refresh tokens: 90 days (7776000 seconds)
     */
    async signToken(payload, secret, tokenType = 'access') {
        const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // SECURITY FIX: Reduced expiration times
        const expirationTimes = {
            access: CONSTANTS.JWT_ACCESS_TOKEN_EXPIRE_SEC,
            refresh: CONSTANTS.JWT_REFRESH_TOKEN_EXPIRE_SEC
        };

        const expiresIn = expirationTimes[tokenType] || expirationTimes.access;
        const exp = Math.floor(Date.now() / 1000) + expiresIn;

        const body = btoa(JSON.stringify({
            ...payload,
            exp,
            type: tokenType // Include token type in payload
        })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');

        const unsigned = `${header}.${body}`;
        const signature = await this.hmacSha256(unsigned, secret);
        return `${unsigned}.${signature}`;
    },


    async verifyToken(token, secret) {
        if (!token || typeof token !== 'string') throw new Error('Invalid token');
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error('Invalid token format');
        const [header, body, signature] = parts;
        if (!header || !body || !signature) throw new Error('Invalid token');

        // Helper to decode base64url safely by restoring padding
        const base64UrlDecode = (str) => {
            let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
            const padLength = (4 - (base64.length % 4)) % 4;
            base64 += '='.repeat(padLength);
            return atob(base64);
        };

        // SECURITY: Validate algorithm header to prevent algorithm confusion attacks
        try {
            const headerObj = JSON.parse(base64UrlDecode(header));
            if (headerObj.alg !== 'HS256') throw new Error('Invalid algorithm');
        } catch {
            throw new Error('Invalid token header');
        }

        const validSignature = await this.hmacSha256(`${header}.${body}`, secret);
        if (!this.constantTimeCompare(signature, validSignature)) throw new Error('Invalid signature');
        let payload;
        try {
            payload = JSON.parse(base64UrlDecode(body));
        } catch {
            throw new Error('Malformed token payload');
        }
        if (!payload || typeof payload !== 'object') throw new Error('Invalid payload');
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
