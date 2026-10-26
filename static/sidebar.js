document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar-navigation");
  const toggle = document.querySelector(".menu-toggle, .portal-menu-toggle");
  const overlay = document.querySelector(".sidebar-overlay, .portal-sidebar-overlay");
  const mobileQuery = window.matchMedia("(max-width: 860px)");

  if (!(sidebar instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement) || !(overlay instanceof HTMLButtonElement)) {
    return;
  }

  let isOpen = false;
  let previousBodyOverflow = document.body.style.overflow;

  const render = () => {
    const drawerIsModal = mobileQuery.matches;
    document.body.classList.toggle("sidebar-open", isOpen && drawerIsModal);
    toggle.setAttribute("aria-expanded", String(isOpen && drawerIsModal));
    toggle.setAttribute("aria-label", isOpen && drawerIsModal ? "Close navigation menu" : "Open navigation menu");
    overlay.hidden = !(isOpen && drawerIsModal);
    sidebar.setAttribute("aria-hidden", String(drawerIsModal && !isOpen));
    sidebar.setAttribute("role", isOpen && drawerIsModal ? "dialog" : "complementary");
    if (isOpen && drawerIsModal) {
      sidebar.setAttribute("aria-modal", "true");
      sidebar.setAttribute("aria-label", "Navigation menu");
    } else {
      sidebar.removeAttribute("aria-modal");
      sidebar.removeAttribute("aria-label");
    }
    sidebar.inert = drawerIsModal && !isOpen;
    document.body.style.overflow = isOpen && drawerIsModal ? "hidden" : previousBodyOverflow;
  };

  const closeMenu = ({ restoreFocus = true } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    render();
    if (restoreFocus && mobileQuery.matches) toggle.focus();
  };

  const accountTriggers = [...sidebar.querySelectorAll("[data-sidebar-profile]")];
  const accountMenus = [...sidebar.querySelectorAll("[data-sidebar-account-menu]")];
  const languageControls = [...sidebar.querySelectorAll("[data-language-control]")];
  let activeLanguage = "en";

  const closeDropdowns = ({ restoreFocus = false } = {}) => {
    accountMenus.forEach((menu) => { menu.hidden = true; });
    accountTriggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    languageControls.forEach((control) => {
      const menu = control.querySelector("[data-language-menu]");
      const button = control.querySelector(".language-toggle, .portal-language");
      if (menu instanceof HTMLElement) menu.hidden = true;
      if (button instanceof HTMLButtonElement) button.setAttribute("aria-expanded", "false");
    });
    if (restoreFocus && document.activeElement instanceof HTMLElement) {
      const owner = document.activeElement.closest("[data-sidebar-account-menu], [data-language-menu]");
      if (owner) {
        const trigger = owner.closest("[data-sidebar-account]")?.querySelector("[data-sidebar-profile]")
          || owner.closest("[data-language-control]")?.querySelector(".language-toggle, .portal-language");
        if (trigger instanceof HTMLElement) trigger.focus();
      }
    }
  };

  const isDropdownOpen = () => accountMenus.some((menu) => !menu.hidden)
    || languageControls.some((control) => control.querySelector("[data-language-menu]")?.hidden === false);

  const renderAccount = () => {
    const profileApi = window.JalSaathiProfile;
<<<<<<< HEAD
    const session = profileApi?.getDemoSession?.() || null;
=======
    const session = profileApi?.getProfile?.() || null;
>>>>>>> raashi-milestone1-backend-db
    sidebar.querySelectorAll("[data-sidebar-account]").forEach((account) => {
      const login = account.querySelector("[data-sidebar-login]");
      const trigger = account.querySelector("[data-sidebar-profile]");
      const nameNode = account.querySelector("[data-sidebar-profile-name]");
      const menu = account.querySelector("[data-sidebar-account-menu]");
      if (!(login instanceof HTMLAnchorElement) || !(trigger instanceof HTMLButtonElement) || !(menu instanceof HTMLElement)) return;
      login.hidden = Boolean(session);
      trigger.hidden = !session;
      if (session) {
        const name = session.displayName || profileApi.getDisplayName();
        if (nameNode) nameNode.textContent = "Profile";
        trigger.setAttribute("aria-label", `Profile for ${name}`);
        trigger.title = name;
      }
    });
  };
  renderAccount();
  window.addEventListener("jalsaathi:auth-changed", renderAccount);
  window.addEventListener("jalsaathi:profile-changed", renderAccount);

  const profileApi = window.JalSaathiProfile;
  const languages = profileApi?.getLanguages?.() || [{ code: "en", label: "English" }];
  try {
    activeLanguage = profileApi?.getLanguage?.() || "en";
  } catch (error) {
    console.error("Could not load the selected JalSaathi language:", error);
  }

  const renderLanguages = () => {
    languageControls.forEach((control) => {
      const label = control.querySelector("[data-language-label]");
      const options = control.querySelector("[data-language-options]");
      const menu = control.querySelector("[data-language-menu]");
      if (label) label.textContent = languages.find((language) => language.code === activeLanguage)?.label || "English";
      if (!(options instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;
      options.replaceChildren();
      languages.forEach((language) => {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(language.code === activeLanguage));
        option.dataset.languageCode = language.code;
        option.textContent = language.label;
        options.append(option);
      });
    });
  };
  renderLanguages();
  window.addEventListener("jalsaathi:language-changed", (event) => {
    activeLanguage = event.detail?.code || profileApi?.getLanguage?.() || "en";
    renderLanguages();
  });

  const languageButtonFor = (control) => control.querySelector(".language-toggle, .portal-language");
  const openLanguageMenu = (control) => {
    closeDropdowns();
    const menu = control.querySelector("[data-language-menu]");
    const button = languageButtonFor(control);
    if (!(menu instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return;
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    (menu.querySelector(`[data-language-code="${activeLanguage}"]`) || menu.querySelector("[data-language-code]"))?.focus();
  };

  languageControls.forEach((control) => {
    const button = languageButtonFor(control);
    const menu = control.querySelector("[data-language-menu]");
    const options = control.querySelector("[data-language-options]");
    if (!(button instanceof HTMLButtonElement) || !(menu instanceof HTMLElement) || !(options instanceof HTMLElement)) return;
    button.addEventListener("click", () => {
      if (!menu.hidden) closeDropdowns();
      else openLanguageMenu(control);
    });
    options.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const option = event.target.closest("[data-language-code]");
      if (!(option instanceof HTMLButtonElement)) return;
      try {
        activeLanguage = profileApi?.setLanguage?.(option.dataset.languageCode) || option.dataset.languageCode || "en";
        renderLanguages();
        closeDropdowns({ restoreFocus: true });
      } catch (error) {
        console.error("Could not update the JalSaathi language selection:", error);
      }
    });
    options.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const optionsList = [...options.querySelectorAll("[data-language-code]")];
      const index = optionsList.indexOf(document.activeElement);
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? optionsList.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + optionsList.length) % optionsList.length;
      event.preventDefault();
      optionsList[nextIndex]?.focus();
    });
  });

  accountTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const account = trigger.closest("[data-sidebar-account]");
      const menu = account?.querySelector("[data-sidebar-account-menu]");
      if (!(menu instanceof HTMLElement)) return;
      if (!menu.hidden) {
        closeDropdowns();
        return;
      }
      closeDropdowns();
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      menu.querySelector("[role='menuitem']")?.focus();
    });
  });

  sidebar.querySelectorAll("[data-sidebar-logout]").forEach((button) => {
<<<<<<< HEAD
    button.addEventListener("click", () => {
      if (!window.confirm(window.JalSaathiI18n?.t("Log out of this demonstration session?") || "Log out of this demonstration session?")) return;
      try {
        window.JalSaathiProfile.logoutDemoSession();
=======
    button.addEventListener("click", async () => {
      if (!window.confirm(window.JalSaathiI18n?.t("Log out of your JalSaathi account?") || "Log out of your JalSaathi account?")) return;
      try {
        await window.JalSaathiProfile.logoutSession();
>>>>>>> raashi-milestone1-backend-db
        renderAccount();
        closeDropdowns();
        closeMenu({ restoreFocus: false });
        window.location.href = "/static/auth.html?view=login";
      } catch (error) {
<<<<<<< HEAD
        console.error("JalSaathi demo logout failed:", error);
=======
        console.error("JalSaathi logout failed:", error);
>>>>>>> raashi-milestone1-backend-db
        window.alert(window.JalSaathiI18n?.t(error instanceof Error ? error.message : "Could not log out.") || (error instanceof Error ? error.message : "Could not log out."));
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Node)) return;
    const inDropdownControl = languageControls.some((control) => control.contains(event.target))
      || [...sidebar.querySelectorAll("[data-sidebar-account]")].some((account) => account.contains(event.target));
    if (isDropdownOpen() && !inDropdownControl) closeDropdowns();
  });

  const focusFirstNavigationLink = () => {
    (sidebar.querySelector(".nav-item, [data-view-link]") || sidebar.querySelector("a"))?.focus();
  };

  toggle.addEventListener("click", () => {
    if (isOpen) {
      closeMenu();
      return;
    }
    previousBodyOverflow = document.body.style.overflow;
    isOpen = true;
    render();
    focusFirstNavigationLink();
  });

  overlay.addEventListener("click", () => closeMenu());
  sidebar.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      closeDropdowns();
      closeMenu({ restoreFocus: false });
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isDropdownOpen()) {
      event.preventDefault();
      closeDropdowns({ restoreFocus: true });
      return;
    }
    if (!isOpen || !mobileQuery.matches) return;
    if (event.key === "Escape") {
      closeMenu();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...sidebar.querySelectorAll("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  mobileQuery.addEventListener("change", () => {
    closeMenu({ restoreFocus: false });
    render();
  });

  render();
});
