# PWA installation and offline test checklist

## Production build

1. Start the FastAPI backend and database with the repository's existing setup.
2. In `farmer-pwa`, copy `.env.example` to `.env.local` and set `FASTAPI_ORIGIN` to the backend origin. Keep `NEXT_PUBLIC_API_URL` empty when using the Next.js rewrite proxy.
3. Run `npm install` if dependencies are not installed, then `npm run build`.
4. Run `npm start` and open `http://localhost:3000/login`.
5. Sign in while online. The dashboard data refresh verifies the session, then the service worker warms the main routes and saved-field detail pages in the background. Wait at least 10 seconds before testing offline.

## Background route warm-up and tab navigation

1. Sign in online and open only `/dashboard`; do not visit the other tabs first. Wait at least 10 seconds.
2. In DevTools > **Application** > **Cache Storage**, inspect `jalsaathi-pages-v6`. It should contain `/dashboard`, `/fields`, `/schedule`, `/weather`, `/alerts`, `/profile`, and `/fields/<id>` for every saved field. There is no `/install` route in this app.
3. Inspect `jalsaathi-static-v6`. It should include the `/_next/static/` JavaScript and CSS assets referenced by the warmed route documents. Confirm no `/api/`, `/weather/`, `/sensor-readings`, or auth responses were cached.
4. In DevTools > **Application** > **Service Workers**, select **Offline**. Reload `/dashboard`, `/fields`, `/schedule`, `/weather`, `/alerts`, `/profile`, and each saved `/fields/<id>` URL separately. Each should render the cached app page and saved local farm snapshot. An unknown/unwarmed route should show the offline fallback.
5. Still offline, return to `/dashboard` and click each bottom navigation tab. Navigation should perform a document load and show its cached page rather than issue an uncached client-side RSC navigation.
6. Confirm the fallback page says (in the selected language) that the page has not been saved yet and links to the dashboard. Non-English fallback translations are marked for native-speaker review in `public/offline.html`.
7. Sign out while online, then confirm `jalsaathi-pages-v6` is removed while the public shell and static assets remain. To test account changes, sign in with another account and confirm old route pages are cleared before new pages are warmed.

## Service worker and browser offline mode

1. Open Chrome DevTools > **Application** > **Service Workers**. Confirm `/sw.js` is activated and controls the page. A service worker is intentionally disabled in Next.js development mode.
2. In DevTools > **Application** > **Cache Storage**, confirm the versioned shell, visited pages, and static asset caches exist. API, auth, weather, and sensor-reading responses must not appear in Cache Storage.
3. In DevTools > **Application** > **Service Workers**, select **Offline**, then reload a page you visited. Confirm the last saved farm snapshot renders with the localized offline banner and last-updated time.
4. While still offline, navigate to a previously visited route and reload it. Confirm it opens from the page cache. Navigate directly to an unvisited route and confirm the standalone offline fallback appears.
5. Confirm profile changes, schedule refresh, and sign-out are disabled or unavailable while offline. Switch language and theme while offline, reload, and confirm both choices persist.
6. To test an expired session, sign in, disable networking, then restore networking after the backend session expires. Confirm the cached dashboard remains visible while offline and the app requests sign-in after reconnecting if the API returns 401.
7. Test weather rate limiting by having the backend respond with 429 or 503 once for current weather. Confirm the previous weather reading and its saved timestamp remain visible, the translated fallback message appears, and refresh is temporarily disabled rather than retried repeatedly.

## Installability and updates

1. Run Lighthouse in Chrome DevTools > **Lighthouse**, select **Progressive Web App**, and run the audit against the production URL. Verify the manifest, service worker, icons, and installability findings.
2. On Android Chrome, open the production site over HTTPS. Use the in-app **Install app** button when Chrome emits the install prompt, or Chrome's menu > **Install app**. Confirm the app opens in standalone display mode and the install prompt disappears.
3. Publish/serve a newer build with an updated service worker version. Confirm the **A new version is available** prompt appears; choose **Reload to update** and confirm the new worker controls the page.

## iOS

1. Serve the production app over HTTPS and open it in Safari on an iPhone or iPad.
2. Use **Share** > **Add to Home Screen**. Launch the saved app and confirm standalone display. The in-app installation hint can be dismissed and remains dismissed after reload.

## Limits to account for

- Service workers and PWA installation on real phones require a secure context: HTTPS, except for browser-recognized localhost development.
- Cached app documents and static assets do not contain protected API payloads. Offline data comes from the signed-in user's local snapshot; it is read-only and cannot reflect changes made elsewhere until a successful online refresh.
- Main route and saved-field HTML documents are warmed in the background after an online session check. Warm-up runs at most once per account every six hours. If a route or one of its lazy assets fails during warm-up, or the browser evicts cached data, that page may still show the offline fallback.
- Browser storage can be cleared or evicted by the operating system. Offline availability is best-effort and should be tested on target devices.
