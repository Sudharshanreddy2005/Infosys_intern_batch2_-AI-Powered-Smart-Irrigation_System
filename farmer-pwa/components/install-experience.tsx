"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_IOS_HINT_KEY = "jalsaathi-ios-install-hint-dismissed";
const DISMISSED_INSTALL_PROMPT_KEY = "jalsaathi-install-prompt-dismissed";

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isSafariOnIOS(): boolean {
  const userAgent = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

export function InstallExperience() {
  const { t } = useI18n();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissedInstallPrompt, setDismissedInstallPrompt] = useState(false);
  const [online, setOnline] = useState(true);
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [actionError, setActionError] = useState(false);

  useEffect(() => {
    const displayModeQuery = window.matchMedia("(display-mode: standalone)");
    const checkInstallation = () => {
      const standalone = isStandalone();
      setInstalled(standalone);
      if (standalone) setShowIosHint(false);
    };
    const updateConnection = () => setOnline(navigator.onLine);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowIosHint(false);
    };
    const onUpdateAvailable = () => setUpdateWaiting(true);

    checkInstallation();
    updateConnection();
    try {
      setDismissedInstallPrompt(window.localStorage.getItem(DISMISSED_INSTALL_PROMPT_KEY) === "true");
    } catch (error) {
      console.error("JalSaathi install prompt preference could not be read:", error);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("jalsaathi:sw-update", onUpdateAvailable);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistration("/").then((registration) => {
        if (registration?.waiting && navigator.serviceWorker.controller) setUpdateWaiting(true);
      }).catch((error: unknown) => {
        console.error("JalSaathi service-worker update status could not be checked:", error);
      });
    }

    if (isSafariOnIOS() && !isStandalone()) {
      try {
        setShowIosHint(window.localStorage.getItem(DISMISSED_IOS_HINT_KEY) !== "true");
      } catch (error) {
        console.error("JalSaathi iOS install hint preference could not be read:", error);
        setShowIosHint(true);
      }
    }
    displayModeQuery.addEventListener("change", checkInstallation);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("jalsaathi:sw-update", onUpdateAvailable);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      displayModeQuery.removeEventListener("change", checkInstallation);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    } catch (error) {
      console.error("JalSaathi installation prompt could not be opened:", error);
      setActionError(true);
    }
  }

  function dismissIosHint() {
    try {
      window.localStorage.setItem(DISMISSED_IOS_HINT_KEY, "true");
    } catch (error) {
      console.error("JalSaathi iOS install hint preference could not be saved:", error);
    }
    setShowIosHint(false);
  }

  function dismissInstallPrompt() {
    try {
      window.localStorage.setItem(DISMISSED_INSTALL_PROMPT_KEY, "true");
    } catch (error) {
      console.error("JalSaathi install prompt preference could not be saved:", error);
    }
    setDismissedInstallPrompt(true);
  }

  async function activateUpdate() {
    try {
      if (!("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (!registration?.waiting) throw new Error("No waiting service-worker update was found.");
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      registration.waiting.postMessage("SKIP_WAITING");
      setUpdateWaiting(false);
    } catch (error) {
      console.error("JalSaathi service-worker update could not be activated:", error);
      setActionError(true);
    }
  }

  const canShowInstallPrompts = online && !installed;

  return <div className="pwa-prompts">
    {actionError && <p className="pwa-prompt-error" role="alert">{t("The app action could not be completed. Please reload and try again.")}</p>}
    {installPrompt && canShowInstallPrompts && !dismissedInstallPrompt && <div className="pwa-prompt install-prompt" role="region" aria-label={t("Install JalSaathi")}>
      <span>{t("Keep JalSaathi on your home screen for quick farm access.")}</span>
      <button className="secondary-button" type="button" onClick={() => void install()}>{t("Install app")}</button>
      <button className="prompt-dismiss" type="button" onClick={dismissInstallPrompt} aria-label={t("Dismiss install banner")}>×</button>
    </div>}
    {showIosHint && canShowInstallPrompts && <div className="pwa-prompt ios-install-hint" role="region" aria-label={t("Install help")}>
      <span>{t("On iPhone or iPad: tap Share, then Add to Home Screen.")}</span>
      <button className="prompt-dismiss" type="button" onClick={dismissIosHint} aria-label={t("Dismiss install help")}>×</button>
    </div>}
    {updateWaiting && <div className="pwa-prompt update-prompt" role="status">
      <span>{t("A new version is available.")}</span>
      <button className="secondary-button" type="button" onClick={() => void activateUpdate()}>{t("Reload to update")}</button>
    </div>}
  </div>;
}
