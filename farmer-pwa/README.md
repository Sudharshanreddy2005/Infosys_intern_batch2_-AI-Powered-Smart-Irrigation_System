# JalSaathi Farmer PWA

## Local development

1. Start the FastAPI backend and PostgreSQL using the repository's existing setup.
2. From `farmer-pwa`, copy `.env.example` to `.env.local`.
3. Keep `NEXT_PUBLIC_API_URL` empty to use the same-origin Next.js rewrite proxy. Set `FASTAPI_ORIGIN` to the reachable backend URL.
4. Configure the backend's `FARMER_PWA_ORIGINS` to allow `http://localhost:3000` and `http://127.0.0.1:3000`; this is used by existing origin/CSRF checks, not CORS.
5. Run `npm install` if dependencies are not installed, then `npm run dev`.
6. Open `http://localhost:3000`.

The browser sends API calls to the Next.js app's `/api` and `/weather` paths. The Next.js rewrites proxy these requests to FastAPI, preserving the existing cookie-session and CSRF flow without requiring browser CORS access.

## Production build

From `farmer-pwa`, run `npm run build` and `npm start`. The service worker is registered only in production.

## PWA installation and offline behavior

Build and run production mode with `npm run build` and `npm start`; the service worker is intentionally not registered by `npm run dev`. The web manifest includes 192px and 512px standard and safe-zone-padded maskable icons. On Android Chrome, use the in-app install prompt. On iOS Safari, use **Share > Add to Home Screen**. Real-device installation requires HTTPS.

Successful profile, field, crop, schedule, and weather data are saved in a local snapshot keyed to the signed-in account and rendered read-only offline. The offline banner and last-updated time identify the snapshot age. Visited route documents and static assets are cached; unvisited routes use `offline.html`. API, weather, sensor-reading, and auth responses are never cached by the service worker. Sign-out clears local farm data and app caches; sign-out and profile updates require a connection.

Language and theme preferences are local and remain available offline. Weather 429/503 responses preserve the last successful weather snapshot and its timestamp; refresh is paused for 60 seconds after a weather rate limit.

See [TESTING.md](./TESTING.md) for the production, offline, installability, Android, iOS, and service-worker update checklist. Browser storage may be evicted, and offline data cannot include changes made on another device until a successful online refresh.

Live sensor readings and alerts are not connected. Field moisture is therefore shown as **Sensor unavailable**, Alerts is an explicit unavailable/empty state, and password recovery is not available from the backend. Crops, reports, predictions, and model-lab remain outside the current milestone.
