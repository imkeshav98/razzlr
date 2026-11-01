// Keeps what the editor needs to open without a connection (#37): the editor pages themselves,
// the app's built scripts and styles, CanvasKit and our fonts, and the images designs use. The
// design itself lives in IndexedDB (see packages/editor); this only lets the page load to read it.
const CACHE = 'razzlr-editor-v2'

const EDITOR_PAGE = /^\/brands\/[^/]+\/designs\/[^/]+$/
const ASSET = /^\/brands\/[^/]+\/assets\/[^/]+$/
/** Built files carry their content hash in the name, and vendor files are pinned: one copy is enough. */
const immutable = (path) => path.startsWith('/_next/static/') || path.startsWith('/vendor/')
/** Pages and images can change: fetch them when we can, and use the kept copy when we can't. */
const fresh = (path) => EDITOR_PAGE.test(path) || ASSET.test(path)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (immutable(url.pathname)) event.respondWith(cacheFirst(request))
  // Only whole-page loads of an editor page: Next's in-app navigations fetch the same path for a
  // different payload, which must never stand in for the page.
  else if (EDITOR_PAGE.test(url.pathname) ? request.mode === 'navigate' : ASSET.test(url.pathname)) event.respondWith(networkFirst(request))
})

// The page names what it loaded before this worker was in charge, so the first visit is enough.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'keep' || !Array.isArray(event.data.urls)) return
  event.waitUntil(keep(event.data.urls))
})

async function keep(urls) {
  const cache = await caches.open(CACHE)
  await Promise.all(urls.map(async (href) => {
    const url = new URL(href, self.location.origin)
    if (url.origin !== self.location.origin || !(immutable(url.pathname) || fresh(url.pathname))) return
    if (immutable(url.pathname) && (await cache.match(url.href))) return
    try {
      const response = await fetch(url.href, { credentials: 'same-origin' })
      if (response.ok) await cache.put(url.href, response)
    } catch {
      // Offline already: nothing to keep this time.
    }
  }))
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const kept = await cache.match(request)
  if (kept) return kept
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (error) {
    const kept = await cache.match(request, { ignoreSearch: true })
    if (kept) return kept
    throw error
  }
}
