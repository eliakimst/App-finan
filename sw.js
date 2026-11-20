const CACHE = 'posso-gastar-v8';
const FILES = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

// Instala e assume o controle logo, sem esperar fechar todas as abas.
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

// Rede primeiro (sempre revalidando com o servidor); cache só sem internet.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const mesmoSite = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    fetch(mesmoSite ? new Request(e.request, { cache: 'no-cache' }) : e.request)
      .then(r => { if (mesmoSite && r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request))
  );
});
