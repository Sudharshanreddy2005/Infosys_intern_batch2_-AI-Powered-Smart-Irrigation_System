const CACHE_PREFIX = "jalsaathi-";
const CACHE_VERSION = "v6";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const PAGE_CACHE = `${CACHE_PREFIX}pages-${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const APP_SHELL = [
  "/dashboard",
  "/offline.html",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/manifest.webmanifest",
];
const ROUTE_PATHS = new Set([
  "/dashboard",
  "/fields",
  "/crops",
  "/schedule",
  "/weather",
  "/alerts",
  "/profile",
]);
let warmGeneration = 0;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shellCache = await caches.open(SHELL_CACHE);
    const dashboardResponse = await fetch("/dashboard", { cache: "reload" });
    const dashboardUrl = new URL("/dashboard", self.location.origin);
    if (!isCacheableDocument(dashboardResponse, dashboardUrl) ||
        await isLoginDocument(dashboardResponse)) {
      throw new Error("The JalSaathi dashboard shell could not be fetched safely.");
    }
    await shellCache.put("/dashboard", dashboardResponse.clone());
    const dashboardHtml = await dashboardResponse.text();
    const dashboardAssets = [...dashboardHtml.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g)]
      .map((match) => new URL(match[1], self.location.origin).toString());
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.addAll([...new Set(dashboardAssets)]);

    await Promise.all(APP_SHELL.filter((url) => url !== "/dashboard").map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (!response.ok) throw new Error(`JalSaathi app-shell resource could not be fetched: ${url}`);
      await shellCache.put(url, response);
    }));
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) &&
          ![SHELL_CACHE, PAGE_CACHE, STATIC_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") void self.skipWaiting();
  if (event.data?.type === "CLEAR_PAGES") {
    warmGeneration += 1;
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
  if (event.data?.type === "WARM_ROUTES" && Array.isArray(event.data.urls)) {
    event.waitUntil(warmRoutes(event.data.urls, event.source, warmGeneration));
  }
});

async function warmRoutes(urls, source, generation) {
  if (!self.navigator.onLine) return;
  const paths = [...new Set(urls
    .filter((value) => typeof value === "string")
    .map((value) => new URL(value, self.location.origin))
    .filter((url) => url.origin === self.location.origin && !url.search && !url.hash)
    .map((url) => url.pathname)
    .filter((path) => ROUTE_PATHS.has(path) || /^\/fields\/\d+$/.test(path)))];
  const pageCache = await caches.open(PAGE_CACHE);
  const results = await Promise.all(paths.map(async (path) => {
    try {
      const target = new URL(path, self.location.origin);
      const response = await fetch(target, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
        headers: { Accept: "text/html" },
      });
      if (!isCacheableDocument(response, target)) return { path, cached: false };
      if (await isLoginDocument(response)) return { path, cached: false };
      const html = await response.clone().text();
      if (generation !== warmGeneration) return { path, cached: false };

      await pageCache.put(target, response.clone());
      const assets = [...html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g)]
        .map((match) => new URL(match[1].replace(/&amp;/g, "&"), self.location.origin))
        .filter((asset) => asset.origin === self.location.origin &&
          asset.pathname.startsWith("/_next/static/"))
        .map((asset) => asset.href);
      return { path, cached: true, assets };
    } catch (error) {
      console.warn("JalSaathi route warm-up failed:", path, error);
      return { path, cached: false };
    }
  }));

  if (generation !== warmGeneration) return;
  const assets = [...new Set(results.flatMap((result) => result.assets ?? []))];
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(assets.map(async (asset) => {
    if (generation !== warmGeneration) return;
    try {
      const response = await fetch(asset, { credentials: "same-origin", cache: "no-store" });
      if (response.ok && response.type === "basic") {
        await staticCache.put(asset, response.clone());
      }
    } catch (error) {
      console.warn("JalSaathi route asset warm-up failed:", asset, error);
    }
  }));
  if (generation !== warmGeneration) return;
  source?.postMessage({
    type: "WARM_ROUTES_COMPLETE",
    results: results.map(({ path, cached }) => ({ path, cached })),
    assetCount: assets.length,
  });
}

function isCacheableDocument(response, target) {
  const responseUrl = new URL(response.url || target.href, self.location.origin);
  return response.status === 200 &&
    response.type === "basic" &&
    !response.redirected &&
    responseUrl.origin === self.location.origin &&
    responseUrl.pathname === target.pathname &&
    !["/login", "/register", "/forgot-password"].includes(target.pathname) &&
    (ROUTE_PATHS.has(target.pathname) || /^\/fields\/\d+$/.test(target.pathname)) &&
    response.headers.get("content-type")?.toLowerCase().includes("text/html") === true;
}

async function isLoginDocument(response) {
  const html = await response.clone().text();
  return /<(?:input|form)\b[^>]*(?:name|id)=["'](?:auth-password|password)["']/i.test(html);
}

async function offlineNavigationResponse(pathname) {
  const route = new URL(pathname, self.location.origin);
  return (await caches.match(route)) ||
    (await caches.match(route, { cacheName: SHELL_CACHE })) ||
    (await caches.match("/offline.html", { cacheName: SHELL_CACHE })) ||
    Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/weather/") ||
    url.pathname.startsWith("/sensor-readings") ||
    url.pathname.startsWith("/auth/")
  ) return;

  if (request.mode === "navigate") {
    if (!self.navigator.onLine) {
      event.respondWith(offlineNavigationResponse(url.pathname));
      return;
    }
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const route = new URL(url.pathname, self.location.origin);
        if (isCacheableDocument(response, route) && !(await isLoginDocument(response))) {
          const cache = await caches.open(PAGE_CACHE);
          await cache.put(route, response.clone());
        }
        return response;
      } catch {
        return offlineNavigationResponse(url.pathname);
      }
    })());
    return;
  }

  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/locales/") ||
    url.pathname === "/offline.html"
  ) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      const refresh = fetch(request).then((response) => {
        if (response.ok) return cache.put(request, response.clone()).then(() => response);
        return response;
      });
      if (cached) {
        event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
        return cached;
      }
      return refresh;
    })());
  }
});
