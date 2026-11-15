(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", async () => {
    const mount = document.querySelector("[data-common-topbar]");
    if (!(mount instanceof HTMLElement)) return;

    try {
      const response = await fetch("/static/topbar.html?v=20261104-sidebar-toggle-fix1", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Header component request failed (${response.status}).`);
      const markup = await response.text();
      const template = document.createElement("template");
      template.innerHTML = markup;
      const header = template.content.querySelector(".common-topbar");
      if (!(header instanceof HTMLElement)) throw new Error("The shared header component is invalid.");
      mount.replaceChildren(header);
      window.dispatchEvent(new CustomEvent("jalsaathi:topbar-mounted"));
    } catch (error) {
      console.error("JalSaathi shared header could not be loaded:", error);
      mount.textContent = "The application header could not be loaded. Please refresh the page.";
      mount.setAttribute("role", "alert");
      return;
    }

    const header = mount.querySelector(".common-topbar");
    const profileApi = window.JalSaathiProfile;
    const languageCatalog = profileApi?.getLanguages?.() || [];
    const languageButton = header.querySelector("[data-language-toggle]");
    const languageMenu = header.querySelector("[data-language-menu]");
    const languageOptions = header.querySelector("[data-language-options]");
    const languageLabel = header.querySelector("[data-language-label]");
    const profileButton = header.querySelector("[data-profile-toggle]");
    const profileMenu = header.querySelector("[data-profile-menu]");
    const notificationButton = header.querySelector("[data-notification-toggle]");
    const notificationPanel = header.querySelector("[data-notification-panel]");


    const enablePushButton = header.querySelector("[data-enable-web-push]");

    enablePushButton.addEventListener("click", async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          throw new Error("Browser push notifications are not supported.");
        }

        const permission = await Notification.requestPermission();

        if (permission !== "granted") {
          throw new Error("Notification permission was not granted.");
        }

        const registration = await navigator.serviceWorker.ready;

        const response = await profileApi.apiRequest("/api/push/public-key");
        const publicKey = response.public_key;

        const padding = "=".repeat((4 - publicKey.length % 4) % 4);

        const applicationServerKey = Uint8Array.from(
          atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + padding),
          character => character.charCodeAt(0)
        );

        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }

        await profileApi.apiRequest("/api/push/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(subscription.toJSON()),
        });

        enablePushButton.textContent = "Notifications Enabled";
        enablePushButton.disabled = true;

        window.alert("Browser notifications enabled successfully!");
      } catch (error) {
        console.error("Could not enable browser notifications:", error);
        window.alert(error.message || "Could not enable browser notifications.");
      }
    });


    const selectedLanguage = () => {
      try {
        return profileApi?.getLanguage?.() || "en";
      } catch (error) {
        console.error("Could not read the selected JalSaathi language:", error);
        return "en";
      }
    };

    const renderLanguages = () => {
      const activeCode = selectedLanguage();
      const active = languageCatalog.find(({ code }) => code === activeCode);
      languageLabel.textContent = active?.label || "English";
      languageOptions.replaceChildren();
      languageCatalog.forEach((language) => {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(language.code === activeCode));
        option.setAttribute("data-i18n-ignore", "");
        option.dataset.languageCode = language.code;
        option.textContent = language.label;
        languageOptions.append(option);
      });
    };

    const renderProfile = () => {
      const profile = profileApi?.getProfile?.();
      profileButton.hidden = !profile;
      if (!profile) return;
      const name = String(profile.name || profile.displayName || profileApi.getDisplayName() || "Farmer").trim();
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2)
        .map((part) => Array.from(part)[0].toLocaleUpperCase()).join("") || "F";
      header.querySelector("[data-profile-avatar]").textContent = initials;
      profileButton.setAttribute("aria-label", "Farmer profile");
    };

    const closeMenus = () => {
      [
        [languageMenu, languageButton],
        [profileMenu, profileButton],
        [notificationPanel, notificationButton],
      ].forEach(([menu, button]) => {
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
      });
    };

    const openMenu = (menu, button, focusSelector) => {
      closeMenus();
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      menu.querySelector(focusSelector)?.focus();
    };

    const toggleMenu = (menu, button, focusSelector) => {
      if (menu.hidden) openMenu(menu, button, focusSelector);
      else closeMenus();
    };

    const componentContains = (target) => header.contains(target);
    document.addEventListener("click", (event) => {
      if (event.target instanceof Node && !componentContains(event.target)) closeMenus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const openControl = header.querySelector("[aria-expanded='true']");
      if (!openControl) return;
      closeMenus();
      openControl.focus();
    });

    languageButton.addEventListener("click", () => toggleMenu(
      languageMenu,
      languageButton,
      `[data-language-code="${selectedLanguage()}"]`,
    ));
    languageOptions.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const option = event.target.closest("[data-language-code]");
      if (!(option instanceof HTMLButtonElement)) return;
      try {
        profileApi.setLanguage(option.dataset.languageCode);
        renderLanguages();
        window.JalSaathiI18n?.translate(header);
        closeMenus();
        languageButton.focus();
      } catch (error) {
        console.error("Could not update the JalSaathi language selection:", error);
        window.alert(error instanceof Error ? error.message : "The language could not be changed.");
      }
    });
    languageOptions.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const options = [...languageOptions.querySelectorAll("[data-language-code]")];
      const index = options.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0
        : event.key === "End" ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      event.preventDefault();
      options[next]?.focus();
    });

    profileButton.addEventListener("click", () => toggleMenu(profileMenu, profileButton, "[role='menuitem']"));
    notificationButton.addEventListener("click", () => toggleMenu(
      notificationPanel,
      notificationButton,
      "#notification-panel",
    ));
    const notificationCount = header.querySelector("[data-notification-count]");
    const notificationList = header.querySelector("[data-notification-list]");
    const notificationEmpty = header.querySelector("[data-notification-empty]");
    const notificationSummary = header.querySelector("[data-notification-summary]");

    const loadNotifications = async () => {
      try {
        const alerts = await profileApi.apiRequest("/api/alerts");

        const unreadCount = alerts.filter(alert => !alert.is_read).length;

        notificationCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        notificationCount.hidden = unreadCount === 0;

        notificationSummary.textContent = `${unreadCount} unread notifications`;
        notificationList.replaceChildren();
        notificationEmpty.hidden = alerts.length > 0;

        alerts.forEach(alert => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "notification-item";
          item.textContent = `${alert.severity.toUpperCase()}: ${alert.message}`;

          if (!alert.is_read) {
            item.style.fontWeight = "bold";
          }

          item.addEventListener("click", async () => {
            if (alert.is_read) return;

            try {
              await profileApi.apiRequest(
                `/api/alerts/${alert.id}/read`,
                { method: "PATCH" }
              );

              await loadNotifications();
            } catch (error) {
              console.error("Could not mark alert as read:", error);
            }
          });

          notificationList.append(item);
        });
      } catch (error) {
        console.error("Could not load notifications:", error);
      }
    };

    notificationButton.addEventListener("click", loadNotifications);

    window.addEventListener("jalsaathi:auth-changed", loadNotifications);

    loadNotifications();
    header.querySelector("[data-topbar-logout]").addEventListener("click", async () => {
      if (!window.confirm(window.JalSaathiI18n?.t("Log out of your JalSaathi account?") || "Log out of your JalSaathi account?")) return;
      try {
        await profileApi.logoutSession();
        window.location.href = "/static/auth.html?view=login";
      } catch (error) {
        console.error("JalSaathi logout failed:", error);
        window.alert(window.JalSaathiI18n?.t(error instanceof Error ? error.message : "Could not log out.") ||
          (error instanceof Error ? error.message : "Could not log out."));
      }
    });

    renderLanguages();
    renderProfile();
    window.JalSaathiI18n?.translate(header);
    window.addEventListener("jalsaathi:language-changed", () => {
      renderLanguages();
      window.JalSaathiI18n?.translate(header);
    });
    window.addEventListener("jalsaathi:auth-changed", renderProfile);
    window.addEventListener("jalsaathi:profile-changed", renderProfile);
  });
})();
