// Service worker: tiene una copia dell'app sul telefono così funziona anche senza rete.
// Strategia "prima la rete": quando c'è connessione si scarica sempre la versione più recente (che aggiorna
// anche la copia); se la rete manca o risponde troppo lentamente si usa la copia salvata.
// Cambiare VERSIONE serve solo per svuotare del tutto la vecchia copia (non è necessario a ogni modifica).
const VERSIONE = 'sopralluoghi-v5';
const FILE = [
  './', 'index.html', 'app.js', 'style.css', 'jspdf.umd.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png'
];
const ATTESA_RETE_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSIONE).then(c => c.addAll(FILE.map(f => new Request(f, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(nomi => Promise.all(nomi.filter(n => n !== VERSIONE).map(n => caches.delete(n))))
  );
  self.clients.claim();
});

// Richiesta alla rete che si arrende dopo ms millisecondi.
function reteConLimite(richiesta, ms) {
  return new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('rete troppo lenta')), ms);
    fetch(richiesta, { cache: 'no-cache' }).then(
      r => { clearTimeout(t); ok(r); },
      err => { clearTimeout(t); ko(err); }
    );
  });
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSIONE);
    try {
      const risposta = await reteConLimite(r, ATTESA_RETE_MS);
      if (risposta.ok) cache.put(r, risposta.clone());
      return risposta;
    } catch (err) {
      const copia = await cache.match(r);
      if (copia) return copia;
      if (r.mode === 'navigate') return (await cache.match('./')) || Response.error();
      return Response.error();
    }
  })());
});
