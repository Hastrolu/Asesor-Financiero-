// ============================================
// SERVICE WORKER - Gestor Financiero PWA
// ============================================

const CACHE_NAME = 'finanzas-v2';

// Archivos a cachear para funcionamiento offline
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Chart.js desde CDN
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js'
];

// ============================================
// INSTALACIÓN - Cachea todos los archivos
// ============================================
self.addEventListener('install', event => {
  console.log('[SW] Instalando Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando archivos...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[SW] Archivos cacheados correctamente');
        // Activa inmediatamente sin esperar a que se cierren otras pestañas
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Error al cachear:', err);
      })
  );
});

// ============================================
// ACTIVACIÓN - Limpia cachés antiguas
// ============================================
self.addEventListener('activate', event => {
  console.log('[SW] Activando Service Worker...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME)
            .map(name => {
              console.log('[SW] Eliminando caché antigua:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker activado');
        // Toma control de todas las páginas inmediatamente
        return self.clients.claim();
      })
  );
});

// ============================================
// FETCH - Estrategia Cache First, Network Fallback
// ============================================
self.addEventListener('fetch', event => {
  // Solo manejamos GET requests
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Si está en caché, devuelve la versión cacheada
        if (cachedResponse) {
          // En segundo plano, intenta actualizar el caché
          fetchAndCache(event.request);
          return cachedResponse;
        }
        
        // Si no está en caché, busca en red
        return fetch(event.request)
          .then(response => {
            // Si la respuesta es válida, guárdala en caché
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Si falla la red y no hay caché, muestra página offline
            // (Para tu app, esto raramente pasará porque todo está cacheado)
            console.log('[SW] Sin conexión y sin caché para:', event.request.url);
          });
      })
  );
});

// ============================================
// HELPER - Actualiza caché en segundo plano
// ============================================
function fetchAndCache(request) {
  fetch(request)
    .then(response => {
      if (response && response.status === 200) {
        caches.open(CACHE_NAME)
          .then(cache => cache.put(request, response));
      }
    })
    .catch(() => {
      // Silencioso - no hay red, no pasa nada
    });
}

// ============================================
// MENSAJE - Para forzar actualización si es necesario
// ============================================
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});