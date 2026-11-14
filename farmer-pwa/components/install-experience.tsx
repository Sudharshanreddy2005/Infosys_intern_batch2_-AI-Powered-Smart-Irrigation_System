"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_IOS_HINT_KEY = "jalsaathi-ios-install-hint-dismissed";
const DISMISSED_INSTALL_PROMPT_KEY = "jalsaathi-install-prompt-dismissed";
type InstallContextValue = { installed: boolean; requestInstall: () => void };
const installContext = createContext<InstallContextValue | null>(null);

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isSafariOnIOS(): boolean {
  return isIOS() && /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

export function useInstallExperience() {
  const value = useContext(installContext);
  if (!value) throw new Error("useInstallExperience must be used within InstallExperience.");
  return value;
}

export function InstallActionButton() {
  const { installed, requestInstall } = useInstallExperience();
  const { t } = useI18n();
  if (installed) return null;
  return (
    <button
      className="icon-button header-action install-action"
      type="button"
      onClick={requestInstall}
      aria-label={t("Install app")}
    >
      <span aria-hidden="true">↓</span>
      <span className="header-action-label">{t("Install app")}</span>
    </button>
  );
}

export function InstallExperience({ children }: Readonly<{ children: React.ReactNode }>) {
  const { t } = useI18n();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissedInstallPrompt, setDismissedInstallPrompt] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
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
    const installedAppsNavigator = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<unknown[]>;
    };
    if (!isStandalone() && installedAppsNavigator.getInstalledRelatedApps) {
      void installedAppsNavigator.getInstalledRelatedApps().then((apps) => {
        if (apps.length > 0) setInstalled(true);
      }).catch((error: unknown) => {
        console.error("JalSaathi installed-app status could not be checked:", error);
      });
    }
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

  const requestInstall = useCallback(() => {
    if (installed) return;
    if (installPrompt && online) {
      void install();
      return;
    }
    setShowInstructions(true);
  }, [installed, installPrompt, online]);

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
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const installationInstructions = isIOS()
    ? t("On iPhone or iPad, tap Share and then Add to Home Screen.")
    : /Android/i.test(userAgent)
      ? t("On Android, open the browser menu and choose Install app or Add to Home Screen.")
      : /Safari/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent)
        ? t("In Safari on Mac, choose File and then Add to Dock.")
        : t("Use your browser’s menu and choose Install app or Add to Home Screen.");

  return (
    <installContext.Provider value={{ installed, requestInstall }}>
      {children}
      <div className="pwa-prompts">
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
      </div>
      {showInstructions && !installed && (
        <div className="install-help-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowInstructions(false);
        }}>
          <section className="install-help-dialog" role="dialog" aria-modal="true" aria-labelledby="install-help-title">
            <header className="form-sheet-heading">
              <h2 id="install-help-title">{t("Installation instructions")}</h2>
              <button className="icon-button" type="button" onClick={() => setShowInstructions(false)} aria-label={t("Close")}>×</button>
            </header>
            {!online && <p className="notice notice-error">{t("Reconnect to the internet before installing JalSaathi.")}</p>}
            <p>{installationInstructions}</p>
            <p className="muted">{t("If installation is unavailable, update your browser and open JalSaathi over HTTPS.")}</p>
            <button className="primary-button" type="button" onClick={() => setShowInstructions(false)}>{t("Close")}</button>
          </section>
        </div>
      )}
    </installContext.Provider>
  );
}
