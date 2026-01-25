// ============================================
// SERVICE WORKER - Gestor Financiero PWA
// ============================================
// ⚠️ CAMBIA ESTE NÚMERO JUNTO CON APP_VERSION EN script.js
const SW_VERSION = '1.0.1';
const CACHE_NAME = 'finanzas-v' + SW_VERSION;

// Archivos a cachear
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js'
];

// ============================================
// INSTALACIÓN
// ============================================
self.addEventListener('install', event => {
    console.log('[SW] Instalando versión:', SW_VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_TO_CACHE))
            .then(() => self.skipWaiting()) // Activa inmediatamente
    );
});

// ============================================
// ACTIVACIÓN - Limpia cachés antiguas
// ============================================
self.addEventListener('activate', event => {
    console.log('[SW] Activando versión:', SW_VERSION);
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name.startsWith('finanzas-') && name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW] Eliminando caché antigua:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim()) // Toma control inmediato
    );
});

// ============================================
// FETCH - Network First para archivos principales
// ============================================
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    
    const url = new URL(event.request.url);
    
    // Para archivos de la app: Network First (busca actualizaciones)
    if (url.pathname.endsWith('.html') || 
        url.pathname.endsWith('.js') || 
        url.pathname.endsWith('.css') ||
        url.pathname === '/' ||
        url.pathname.endsWith('/')) {
        
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Guardar en caché la versión nueva
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Si no hay red, usar caché
                    return caches.match(event.request);
                })
        );
    } else {
        // Para otros recursos (CDN, imágenes): Cache First
        event.respondWith(
            caches.match(event.request)
                .then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                        return response;
                    });
                })
        );
    }
});

// ============================================
// MENSAJE - Para forzar actualización
// ============================================
self.addEventListener('message', event => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
