(() => {
  "use strict";

  const LANGUAGE_KEY = "jalsaathi.main.pwa-language.v1";
  let deferredPrompt = null;
  let installed = false;
  let installedByEvent = false;
  let promptInProgress = false;
  let manualOptions = false;
  let workerAvailable = Boolean(window.isSecureContext && "serviceWorker" in navigator);
  let dialog;
  let status;
  let instructions;

  const translate = (key) => window.JalSaathiI18n?.t(key) || key;
  const isStandalone = () =>
    (window.matchMedia?.("(display-mode: standalone)").matches ?? false) ||
    navigator.standalone === true;

  const storeLanguage = () => {
    try {
      const language = window.JalSaathiProfile?.getLanguage?.() ||
        window.JalSaathiI18n?.getLanguage?.() || "en";
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch (error) {
      console.warn("JalSaathi offline language preference could not be saved.", error);
    }
  };

  const instructionKey = () => {
    const userAgent = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
      return "install.ios";
    }
    if (/Android/i.test(userAgent)) return "install.android";
    if (/Electron/i.test(userAgent)) return "install.embedded";
    if (/Edg\//i.test(userAgent)) return "install.edge";
    if (/Safari/i.test(userAgent) && !/Chrome|Chromium/i.test(userAgent)) {
      return "install.safariDesktop";
    }
    if (/Firefox/i.test(userAgent)) return "install.firefox";
    if (/Chrome|Chromium/i.test(userAgent)) return "install.chrome";
    return "install.generic";
  };

  const stateForButton = () => {
    if (promptInProgress) return { state: "installing", key: "install.installing" };
    if (installed) return { state: "installed", key: "install.alreadyInstalled" };
    if (!workerAvailable || manualOptions) return { state: "unavailable", key: "install.options" };
    return { state: "ready", key: "install.button" };
  };

  const syncButtons = () => {
    const { state, key } = stateForButton();
    document.querySelectorAll("[data-install-app]").forEach((button) => {
      const label = button.querySelector("[data-install-label]");
      if (label) {
        label.dataset.i18nKey = key;
        label.textContent = translate(key);
      }
      button.dataset.installState = state;
      button.toggleAttribute("data-installed", installed);
      button.disabled = promptInProgress;
      if (promptInProgress) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
      button.setAttribute("aria-label", translate(key));
      button.title = translate(key);
    });
  };

  const ensureDialog = () => {
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "common-install-dialog";
    dialog.id = "common-install-dialog";
    dialog.setAttribute("aria-labelledby", "common-install-title");
    const heading = document.createElement("h2");
    heading.id = "common-install-title";
    heading.dataset.i18nKey = "install.title";
    heading.textContent = translate("install.title");
    const description = document.createElement("p");
    description.dataset.i18nKey = "install.description";
    description.textContent = translate("install.description");
    instructions = document.createElement("p");
    status = document.createElement("p");
    status.className = "common-install-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const footer = document.createElement("div");
    footer.className = "common-install-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "common-chart-primary";
    close.dataset.i18nKey = "install.close";
    close.textContent = translate("install.close");
    close.addEventListener("click", () => dialog.close());
    footer.append(close);
    dialog.append(heading, description, instructions, status, footer);
    document.body.append(dialog);
  };

  const showInstallDialog = (statusKey, includeInstructions = true) => {
    ensureDialog();
    const instruction = includeInstructions ? instructionKey() : "";
    if (instruction) instructions.dataset.i18nKey = instruction;
    else delete instructions.dataset.i18nKey;
    instructions.textContent = instruction ? translate(instruction) : "";
    if (statusKey) status.dataset.i18nKey = statusKey;
    else delete status.dataset.i18nKey;
    status.textContent = statusKey ? translate(statusKey) : "";
    window.JalSaathiI18n?.translate(dialog);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("button")?.focus();
  };

  const detectRelatedInstallation = async () => {
    if (!window.isSecureContext ||
        typeof navigator.getInstalledRelatedApps !== "function") return null;
    try {
      const response = await fetch("/manifest.webmanifest", { cache: "no-store" });
      if (!response.ok) throw new Error(`Manifest request failed with status ${response.status}.`);
      const manifest = await response.json();
      const manifestId = new URL(manifest.id || "/", response.url).href;
      const installedApps = await navigator.getInstalledRelatedApps();
      return installedApps.some((app) =>
        app.platform === "webapp" &&
        (app.id === manifestId ||
          (typeof app.url === "string" &&
            new URL(app.url, location.href).href === response.url))
      );
    } catch (error) {
      console.warn("JalSaathi installed-app status could not be checked.", error);
      return null;
    }
  };

  const refreshInstalledState = async ({ recheckAfterReturn = false } = {}) => {
    const relatedInstallation = await detectRelatedInstallation();
    if (relatedInstallation === null) {
      if (recheckAfterReturn) installedByEvent = false;
      installed = isStandalone() || installedByEvent;
    } else {
      installed = isStandalone() || relatedInstallation;
      if (!installed) installedByEvent = false;
    }
    if (installed) {
      deferredPrompt = null;
      manualOptions = false;
    }
    syncButtons();
    return installed;
  };

  const requestInstall = async () => {
    if (promptInProgress) return;
    if (installed || isStandalone()) {
      showInstallDialog("install.statusInstalled", false);
      return;
    }
    if (!navigator.onLine) {
      showInstallDialog("install.onlineRequired", false);
      return;
    }
    if (!window.isSecureContext || !workerAvailable) {
      manualOptions = true;
      syncButtons();
      showInstallDialog("install.unavailable", false);
      return;
    }
    if (!deferredPrompt) {
      manualOptions = true;
      syncButtons();
      showInstallDialog("install.statusManual");
      void refreshInstalledState();
      return;
    }

    const prompt = deferredPrompt;
    deferredPrompt = null;
    manualOptions = false;
    promptInProgress = true;
    syncButtons();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === "accepted") {
        if (await refreshInstalledState()) {
          showInstallDialog("install.statusInstalled", false);
        } else {
          manualOptions = true;
          showInstallDialog("install.statusAccepted", false);
        }
      } else if (choice?.outcome === "dismissed") {
        await refreshInstalledState();
        if (!installed) {
          manualOptions = true;
          showInstallDialog("install.statusCancelled");
        }
      } else {
        showInstallDialog("install.promptError");
      }
    } catch (error) {
      console.error("JalSaathi installation prompt could not be opened.", error);
      manualOptions = true;
      showInstallDialog("install.promptError");
    } finally {
      promptInProgress = false;
      syncButtons();
    }
  };

  const registerWorker = async () => {
    if (!workerAvailable) {
      syncButtons();
      return;
    }
    try {
      await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    } catch (error) {
      workerAvailable = false;
      console.error("JalSaathi main-app service worker could not be registered.", error);
      syncButtons();
    }
  };

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-install-app]")) return;
    void requestInstall();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    if (installed || isStandalone()) return;
    event.preventDefault();
    deferredPrompt = event;
    manualOptions = false;
    syncButtons();
  });
  window.addEventListener("appinstalled", () => {
    installedByEvent = true;
    installed = true;
    deferredPrompt = null;
    manualOptions = false;
    syncButtons();
    showInstallDialog("install.statusInstalled", false);
  });
  window.addEventListener("jalsaathi:language-changed", () => {
    storeLanguage();
    syncButtons();
    if (dialog) window.JalSaathiI18n?.translate(dialog);
  });
  window.addEventListener("jalsaathi:auth-changed", storeLanguage);
  window.addEventListener("jalsaathi:profile-changed", storeLanguage);
  window.addEventListener("jalsaathi:topbar-mounted", syncButtons);
  window.addEventListener("focus", () => {
    void refreshInstalledState({ recheckAfterReturn: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshInstalledState({ recheckAfterReturn: true });
  });
  const displayMode = window.matchMedia?.("(display-mode: standalone)");
  if (displayMode?.addEventListener) {
    displayMode.addEventListener("change", () => {
      void refreshInstalledState({ recheckAfterReturn: true });
    });
  } else {
    displayMode?.addListener?.(() => {
      void refreshInstalledState({ recheckAfterReturn: true });
    });
  }

  storeLanguage();
  syncButtons();
  void refreshInstalledState();
  void registerWorker();
})();
