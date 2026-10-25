const CACHE_NAME = "olowo-shell-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/assets/brand/oloo-wordmark.png", "/assets/brand/oloo-scooter-c5.png", "/assets/brand/olowo-icon-192.png", "/assets/brand/olowo-icon-512.png"];

self.addEventListener("install", event => {
	event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
	self.skipWaiting();
});

self.addEventListener("activate", event => {
	event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
	self.clients.claim();
});

self.addEventListener("fetch", event => {
	if (event.request.method !== "GET") return;
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;

	event.respondWith(
		fetch(event.request)
			.then(response => {
				const copy = response.clone();
				void caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
				return response;
			})
			.catch(() => caches.match(event.request).then(response => response ?? caches.match("/")))
	);
});
