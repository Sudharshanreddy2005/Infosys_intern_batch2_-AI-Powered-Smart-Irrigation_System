(() => {
  "use strict";

  const LANGUAGE_KEY = "jalsaathi.main.pwa-language.v1";
  let deferredPrompt = null;
  let installed = false;
  let workerAvailable = "serviceWorker" in navigator;
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
    if (/Safari/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent)) {
      return "install.safariDesktop";
    }
    return "install.generic";
  };

  const syncButtons = () => {
    document.querySelectorAll("[data-install-app]").forEach((button) => {
      const label = button.querySelector("[data-install-label]");
      if (label) {
        const key = installed ? "install.alreadyInstalled" : "install.button";
        label.dataset.i18nKey = key;
        label.textContent = translate(key);
      }
      button.toggleAttribute("data-installed", installed);
      button.setAttribute("aria-label", translate(installed ? "install.alreadyInstalled" : "install.button"));
      button.title = translate(installed ? "install.alreadyInstalled" : "install.button");
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

  const openInstructions = () => {
    ensureDialog();
    const statusKey = installed
      ? "install.statusInstalled"
      : !navigator.onLine
        ? "install.onlineRequired"
        : !workerAvailable
          ? "install.unavailable"
          : "";
    const instruction = statusKey ? "" : instructionKey();
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

  const updateInstalled = (value) => {
    installed = Boolean(value);
    syncButtons();
  };

  const requestInstall = async () => {
    if (installed) {
      openInstructions();
      return;
    }
    if (!navigator.onLine) {
      openInstructions();
      return;
    }
    if (!deferredPrompt || !workerAvailable) {
      openInstructions();
      return;
    }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") updateInstalled(true);
    } catch (error) {
      console.error("JalSaathi installation prompt could not be opened.", error);
      openInstructions();
      ensureDialog();
      status.dataset.i18nKey = "install.promptError";
      status.textContent = translate("install.promptError");
      window.JalSaathiI18n?.translate(dialog);
    }
  };

  const registerWorker = () => {
    if (!workerAvailable) {
      console.warn("This browser does not support service workers; offline installation is unavailable.");
      return;
    }
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
      .catch((error) => {
        workerAvailable = false;
        console.error("JalSaathi main-app service worker could not be registered.", error);
      });
  };

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-install-app]")) return;
    void requestInstall();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });
  window.addEventListener("appinstalled", () => updateInstalled(true));
  window.addEventListener("jalsaathi:language-changed", () => {
    storeLanguage();
    syncButtons();
    if (dialog) window.JalSaathiI18n?.translate(dialog);
  });
  window.addEventListener("jalsaathi:auth-changed", storeLanguage);
  window.addEventListener("jalsaathi:profile-changed", storeLanguage);
  window.addEventListener("jalsaathi:topbar-mounted", syncButtons);
  const displayMode = window.matchMedia?.("(display-mode: standalone)");
  if (displayMode?.addEventListener) {
    displayMode.addEventListener("change", (event) => {
      if (event.matches) updateInstalled(true);
    });
  } else {
    displayMode?.addListener?.((event) => {
      if (event.matches) updateInstalled(true);
    });
  }

  const relatedApps = navigator.getInstalledRelatedApps;
  if (!isStandalone() && typeof relatedApps === "function") {
    void relatedApps.call(navigator).then((apps) => {
      if (apps.length) updateInstalled(true);
    }).catch((error) => {
      console.warn("JalSaathi installed-app status could not be checked.", error);
    });
  }

  storeLanguage();
  updateInstalled(isStandalone());
  registerWorker();
})();
