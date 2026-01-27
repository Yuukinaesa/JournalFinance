/**
 * ======================================================================
 * SERVICE WORKER - PROFESSIONAL PWA IMPLEMENTATION
 * ======================================================================
 * Version: 2.0.0
 * Strategy: Network First, Cache Fallback (for dynamic content)
 * Cache Strategy: Stale-While-Revalidate (for static assets)
 * ======================================================================
 */

const CACHE_VERSION = 'journal-finance-v2.0.4-session';
const CACHE_NAME = `${CACHE_VERSION}-static`;
const CACHE_DYNAMIC = `${CACHE_VERSION}-dynamic`;
const CACHE_IMAGES = `${CACHE_VERSION}-images`;

// Static assets to precache
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './OptimizedDB.js',
    './app.js',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;700;800&display=swap'
];

// Maximum cache sizes
const MAX_CACHE_SIZE = {
    dynamic: 50,
    images: 100
};

/**
 * Install Event - Precache static assets
 */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                return self.skipWaiting(); // Activate immediately
            })
    );
});

/**
 * Activate Event - Clean up old caches
 */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => {
                            // Delete old versions
                            return name.startsWith('journal-finance-') &&
                                name !== CACHE_NAME &&
                                name !== CACHE_DYNAMIC &&
                                name !== CACHE_IMAGES;
                        })
                        .map((name) => {
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                return self.clients.claim(); // Take control immediately
            })
    );
});

/**
 * Fetch Event - Smart caching strategy
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip chrome extensions and other protocols
    if (!url.protocol.startsWith('http')) {
        return;
    }

    // SECURITY: Do NOT cache API calls. Let the app handle data storage (IndexedDB).
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Different strategies for different content types
    if (request.destination === 'image') {
        // Images: Cache First, Network Fallback
        event.respondWith(cacheFirstStrategy(request, CACHE_IMAGES, MAX_CACHE_SIZE.images));
    } else if (url.origin === location.origin) {
        // Same-origin: Network First, Cache Fallback (for HTML/JS)
        event.respondWith(networkFirstStrategy(request, CACHE_DYNAMIC, MAX_CACHE_SIZE.dynamic));
    } else {
        // External (fonts, etc): Cache First
        event.respondWith(cacheFirstStrategy(request, CACHE_NAME));
    }
});

/**
 * Network First Strategy
 * Try network first, fallback to cache if offline
 */
async function networkFirstStrategy(request, cacheName, maxSize) {
    try {
        const networkResponse = await fetch(request);

        // Cache successful responses
        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());

            // Trim cache if needed
            if (maxSize) {
                trimCache(cacheName, maxSize);
            }
        }

        return networkResponse;
    } catch (error) {
        // Network failed, try cache
        const cachedResponse = await caches.match(request);

        if (cachedResponse) {
            return cachedResponse;
        }

        // No cache available, return offline page or error
        return new Response('Offline - No cached version available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
                'Content-Type': 'text/plain'
            })
        });
    }
}

/**
 * Cache First Strategy
 * Try cache first, fallback to network
 */
async function cacheFirstStrategy(request, cacheName, maxSize) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    // Not in cache, fetch from network
    try {
        const networkResponse = await fetch(request);

        if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(cacheName);
            cache.put(request, networkResponse.clone());

            if (maxSize) {
                trimCache(cacheName, maxSize);
            }
        }

        return networkResponse;
    } catch (error) {
        return new Response('Resource not available offline', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

/**
 * Trim cache to max size (LRU - Least Recently Used)
 */
async function trimCache(cacheName, maxSize) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maxSize) {
        const keysToDelete = keys.slice(0, keys.length - maxSize);
        await Promise.all(keysToDelete.map(key => cache.delete(key)));
    }
}

/**
 * Message Event - Handle messages from app
 * SECURITY: Origin verification to prevent cross-origin attacks
 */
self.addEventListener('message', (event) => {
    // SECURITY: Verify message origin - only accept from same origin
    if (!event.source || !event.source.url) {
        console.warn('SW: Rejecting message from unknown source');
        return;
    }

    try {
        const sourceOrigin = new URL(event.source.url).origin;
        const swOrigin = new URL(self.location.href).origin;

        if (sourceOrigin !== swOrigin) {
            console.warn('SW: Rejecting cross-origin message from:', sourceOrigin);
            return;
        }
    } catch (e) {
        console.warn('SW: Invalid source URL, rejecting message');
        return;
    }

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((name) => caches.delete(name))
                );
            })
        );
    }
});

/**
 * Sync Event - Background sync (future feature)
 */
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-entries') {
        event.waitUntil(
            // Future: Sync entries to server
            Promise.resolve()
        );
    }
});

/**
 * Push Event - Push notifications (future feature)
 */
self.addEventListener('push', (event) => {
    const options = {
        body: event.data ? event.data.text() : 'New update available',
        icon: './icons/icon-192x192.png',
        badge: './icons/icon-72x72.png',
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification('JournalFinance', options)
    );
});
