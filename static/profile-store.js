(function () {
  "use strict";

  const STORAGE_KEY = "jalsaathi.demo.profile.v1";
  const SESSION_KEY = "jalsaathi.demo.session.v1";
  const LANGUAGE_KEY = "jalsaathi.language.v1";
  const DEFAULT_NAME = "Farmer";
  const message = (source) => window.JalSaathiI18n?.t(source) || source;
  const languages = [
    { code: "en", label: "English" },
    { code: "te", label: "తెలుగు" },
    { code: "hi", label: "हिंदी" },
    { code: "kn", label: "ಕನ್ನಡ" },
    { code: "ta", label: "தமிழ்" },
    { code: "ml", label: "മലയാളം" },
    { code: "mr", label: "मराठी" },
    { code: "bn", label: "বাংলা" },
  ];
  let displayName = DEFAULT_NAME;
  let persistenceWarning = "";

  const publish = () => {
    document.querySelectorAll("[data-user-name]").forEach((node) => { node.textContent = displayName; });
    window.dispatchEvent(new CustomEvent("jalsaathi:profile-changed", { detail: { displayName } }));
  };

  const setDisplayName = (value) => {
    const name = String(value || "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 80) throw new Error(message("Enter a name between 1 and 80 characters."));
    displayName = name;
    try {
      localStorage.setItem(STORAGE_KEY, displayName);
      persistenceWarning = "";
    } catch (error) {
      persistenceWarning = message("Browser storage is unavailable; this name change will last only until the page is closed.");
      console.error("JalSaathi demo profile could not be saved:", error);
    }
    publish();
    return displayName;
  };

  const getDemoSession = () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || typeof session.displayName !== "string" || !session.displayName.trim()) return null;
      return {
        displayName: session.displayName.trim().slice(0, 80),
        email: typeof session.email === "string" ? session.email.trim().slice(0, 254) : "",
        phone: typeof session.phone === "string" ? session.phone.trim().slice(0, 32) : "",
      };
    } catch (error) {
      console.error("JalSaathi demo session could not be read:", error);
      return null;
    }
  };

  const setDemoSession = ({ displayName: name, email = "", phone = "" } = {}) => {
    const display = name ? String(name).trim().replace(/\s+/g, " ") : displayName;
    if (!display || display.length > 80) throw new Error(message("A valid display name is required for the demo session."));
    if (name) setDisplayName(display);
    const session = {
      displayName: display,
      email: String(email || "").trim().slice(0, 254),
      phone: String(phone || "").trim().slice(0, 32),
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      console.error("JalSaathi demo session could not be saved:", error);
      throw new Error(message("Browser session storage is unavailable. The demo session was not started."));
    }
    window.dispatchEvent(new CustomEvent("jalsaathi:auth-changed", { detail: session }));
    return session;
  };

  const updateDemoSession = (changes = {}) => {
    const current = getDemoSession();
    if (!current) throw new Error(message("Sign in to the frontend demo before changing profile information."));
    return setDemoSession({ ...current, ...changes });
  };

  const logoutDemoSession = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.error("JalSaathi demo session could not be cleared:", error);
      throw new Error(message("Could not clear the browser demo session."));
    }
    window.dispatchEvent(new CustomEvent("jalsaathi:auth-changed", { detail: null }));
  };

  const getLanguage = () => {
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      return languages.some((language) => language.code === saved) ? saved : "en";
    } catch (error) {
      console.error("JalSaathi language preference could not be read:", error);
      return "en";
    }
  };

  const setLanguage = (code) => {
    if (!languages.some((language) => language.code === code)) throw new Error("Choose a supported language.");
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch (error) {
      console.error("JalSaathi language preference could not be saved:", error);
      throw new Error(message("The language selection could not be saved in this browser."));
    }
    window.dispatchEvent(new CustomEvent("jalsaathi:language-changed", { detail: { code } }));
    document.documentElement.lang = ({
      en: "en", te: "te-IN", hi: "hi-IN", kn: "kn-IN",
      ta: "ta-IN", ml: "ml-IN", mr: "mr-IN", bn: "bn-IN",
    })[code];
    return code;
  };

  try {
    const savedName = localStorage.getItem(STORAGE_KEY);
    if (savedName && savedName.trim()) displayName = savedName.trim().replace(/\s+/g, " ").slice(0, 80);
  } catch (error) {
    persistenceWarning = "Browser storage is unavailable; profile changes may not persist.";
    console.error("JalSaathi demo profile could not be read:", error);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    displayName = event.newValue?.trim().replace(/\s+/g, " ").slice(0, 80) || DEFAULT_NAME;
    publish();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_KEY) {
      window.dispatchEvent(new CustomEvent("jalsaathi:language-changed", { detail: { code: getLanguage() } }));
    }
  });

  window.JalSaathiProfile = {
    getDisplayName: () => displayName,
    getPersistenceWarning: () => persistenceWarning,
    setDisplayName,
    getDemoSession,
    setDemoSession,
    updateDemoSession,
    logoutDemoSession,
    getLanguages: () => languages.map((language) => ({ ...language })),
    getLanguage,
    setLanguage,
  };
  document.addEventListener("DOMContentLoaded", publish, { once: true });
})();
