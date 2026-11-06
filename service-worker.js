// ============================================
// SERVICE WORKER - Gestor Financiero PWA
// ============================================
// Sube este número cuando cambies los archivos de la app para limpiar la caché vieja
const SW_VERSION = '1.2.0';
const CACHE_NAME = 'finanzas-v' + SW_VERSION;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

// Borra cachés de versiones anteriores
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(names
                .filter(name => name.startsWith('finanzas-') && name !== CACHE_NAME)
                .map(name => caches.delete(name))))
            .then(() => self.clients.claim())
    );
});

function putInCache(request, response) {
    if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isAppFile = url.origin === self.location.origin &&
        (request.mode === 'navigate' || /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/'));

    if (isAppFile) {
        // Archivos de la app: red primero (para recibir actualizaciones), caché si no hay conexión
        event.respondWith(
            fetch(request)
                .then(response => putInCache(request, response))
                .catch(() => caches.match(request).then(cached => cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
        );
    } else {
        // Resto (Chart.js, iconos): caché primero
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request).then(response => putInCache(request, response)))
        );
    }
});
