const CACHE_NAME = 'cli-trains-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/stations.json',
  '/icon.svg'
];

// Install Event - Caches critical application shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Caching App Shell Assets...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clears out old cache versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Clearing Obsolete Cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Serves cached assets when offline, intercepts network requests
self.addEventListener('fetch', event => {
  // Let API requests bypass PWA Cache (handled by edge headers, live updates needed)
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache immediately
          return cachedResponse;
        }
        
        // Fallback to fetch from network
        return fetch(event.request).then(response => {
          // Return valid network response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Optionally cache dynamically fetched files (e.g. external icons or fonts)
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          
          return response;
        });
      }).catch(() => {
        // Fallback if both cache and network fail (offline mode)
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});
