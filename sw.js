/**
 * Route Optimizer - Service Worker
 * Provides offline functionality and caching for PWA
 */

const CACHE_NAME = 'route-optimizer-v1';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching static assets');
                return cache.addAll(STATIC_ASSETS)
                    .catch(err => console.log('Some assets failed to cache:', err));
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // For API calls (Nominatim, OSRM, Valhalla), always use network
    if (url.hostname.includes('nominatim') || 
        url.hostname.includes('osrm') ||
        url.hostname.includes('router.project-osrm') ||
        url.hostname.includes('valhalla')) {
        event.respondWith(
            fetch(request)
                .catch(() => {
                    return new Response(
                        JSON.stringify({ error: 'Network unavailable' }),
                        { headers: { 'Content-Type': 'application/json' } }
                    );
                })
        );
        return;
    }
    
    // For tile servers, use cache-first strategy
    if (url.hostname.includes('tile.openstreetmap')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(request).then((cachedResponse) => {
                    const fetchPromise = fetch(request).then((networkResponse) => {
                        cache.put(request, networkResponse.clone());
                        return networkResponse;
                    }).catch(() => cachedResponse);
                    
                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }
    
    // For static assets, use cache-first strategy
    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                
                return fetch(request).then((networkResponse) => {
                    // Cache successful responses
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return networkResponse;
                });
            })
            .catch(() => {
                // Return offline page for navigation requests
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            })
    );
});
