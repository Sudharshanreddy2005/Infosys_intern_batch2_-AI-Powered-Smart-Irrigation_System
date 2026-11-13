"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const notifyWaiting = () => window.dispatchEvent(new Event("jalsaathi:sw-update"));
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) notifyWaiting();
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", (event) => {
          const worker = event.target as ServiceWorker;
          if (worker.state === "installed" && navigator.serviceWorker.controller) notifyWaiting();
        });
      });
    }).catch((error: unknown) => {
      console.error("JalSaathi offline support could not be enabled:", error);
    });
  }, []);

  return null;
}
