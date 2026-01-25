// ============================================
// SERVICE WORKER - Gestor Financiero PWA
// ============================================
// ⚠️ CAMBIA ESTE NÚMERO JUNTO CON APP_VERSION EN script.js
const SW_VERSION = '1.0.0';
const CACHE_NAME = 'finanzas-v' + SW_VERSION;

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
// INSTALACIÃ“N - Cachea todos los archivos
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
        // Activa inmediatamente sin esperar a que se cierren otras pestaÃ±as
        return self.skipWaiting();
      })
      .catch(err => {
        console.error('[SW] Error al cachear:', err);
      })
  );
});

// ============================================
// ACTIVACIÃ“N - Limpia cachÃ©s antiguas
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
              console.log('[SW] Eliminando cachÃ© antigua:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service Worker activado');
        // Toma control de todas las pÃ¡ginas inmediatamente
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
        // Si estÃ¡ en cachÃ©, devuelve la versiÃ³n cacheada
        if (cachedResponse) {
          // En segundo plano, intenta actualizar el cachÃ©
          fetchAndCache(event.request);
          return cachedResponse;
        }
        
        // Si no estÃ¡ en cachÃ©, busca en red
        return fetch(event.request)
          .then(response => {
            // Si la respuesta es vÃ¡lida, guÃ¡rdala en cachÃ©
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Si falla la red y no hay cachÃ©, muestra pÃ¡gina offline
            // (Para tu app, esto raramente pasarÃ¡ porque todo estÃ¡ cacheado)
            console.log('[SW] Sin conexiÃ³n y sin cachÃ© para:', event.request.url);
          });
      })
  );
});

// ============================================
// HELPER - Actualiza cachÃ© en segundo plano
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
// MENSAJE - Para forzar actualizaciÃ³n si es necesario
// ============================================
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});