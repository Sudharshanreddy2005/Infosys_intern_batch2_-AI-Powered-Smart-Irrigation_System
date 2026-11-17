(() => {
  "use strict";

  document.addEventListener("DOMContentLoaded", async () => {
    const mount = document.querySelector("[data-common-topbar]");
    if (!(mount instanceof HTMLElement)) return;

    try {
      const response = await fetch("/static/topbar.html?v=20261124-account-settings1", {
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
    const notificationCount = header.querySelector("[data-notification-count]");
    const notificationList = header.querySelector("[data-notification-list]");
    const notificationEmpty = header.querySelector("[data-notification-empty]");
    const notificationLoading = header.querySelector("[data-notification-loading]");
    const notificationSummary = header.querySelector("[data-notification-summary]");
    const notificationFeedback = header.querySelector("[data-notification-feedback]");
    const enablePushButton = header.querySelector("[data-enable-web-push]");
    const chartAssistantLink = header.querySelector("[data-chart-assistant-open]");

    chartAssistantLink.hidden =
      new URLSearchParams(window.location.search).get("view") === "chart-assistant";

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
    profileMenu.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a[role='menuitem']")) {
        closeMenus();
      }
    });
    let notificationLoadActive = false;
    const notificationIcon = (category) => ({
      weather: "☁",
      irrigation: "💧",
      sensors: "⌁",
      crops: "🌱",
      system: "⚙",
      fields: "▣",
    }[category] || "•");
    const notificationTime = (value) => {
      const timestamp = new Date(value);
      if (Number.isNaN(timestamp.getTime())) return "";
      return new Intl.DateTimeFormat(selectedLanguage(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(timestamp);
    };
    const loadNotifications = async (showLoading = false) => {
      if (notificationLoadActive) {
        if (showLoading) notificationLoading.hidden = false;
        return;
      }
      notificationLoadActive = true;
      notificationFeedback.hidden = true;
      notificationLoading.hidden = !showLoading;
      if (showLoading) notificationEmpty.hidden = true;
      try {
        try {
          await profileApi.apiRequest("/api/alerts/refresh", { method: "POST" });
        } catch (error) {
          console.warn("JalSaathi automated alerts could not be refreshed:", error);
        }
        const [alerts, counts] = await Promise.all([
          profileApi.apiRequest("/api/alerts?limit=5"),
          profileApi.apiRequest("/api/alerts/counts"),
        ]);
        if (!Array.isArray(alerts)) throw new Error("The notifications response is invalid.");
        if (!counts || !Number.isInteger(counts.unread)) {
          throw new Error("The notification counts response is invalid.");
        }
        const unreadCount = counts.unread;
        notificationCount.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        notificationCount.hidden = unreadCount === 0;
        notificationSummary.textContent = `${unreadCount} unread notifications`;
        notificationList.replaceChildren();
        notificationEmpty.hidden = alerts.length > 0;
        alerts.forEach((alert) => {
          const item = document.createElement("article");
          item.className = `notification-item${alert.is_read ? "" : " is-unread"}`;
          const icon = document.createElement("span");
          icon.className = "notification-item-icon";
          icon.setAttribute("aria-hidden", "true");
          icon.textContent = notificationIcon(alert.category);
          const content = document.createElement("div");
          content.className = "notification-item-content";
          const heading = document.createElement("div");
          heading.className = "notification-item-heading";
          const title = document.createElement("strong");
          title.textContent = alert.title || "Notification";
          const category = document.createElement("span");
          category.textContent = String(alert.category || "fields").replaceAll("_", " ");
          heading.append(title, category);
          const message = document.createElement("p");
          message.textContent = alert.message;
          const details = document.createElement("small");
          const fieldLabel = alert.field_name ? `${alert.field_name} · ` : "";
          details.textContent = `${fieldLabel}${notificationTime(alert.created_at)} · ${alert.is_read ? "Read" : "Unread"}`;
          content.append(heading, message, details);
          item.append(icon, content);
          if (!alert.is_read) {
            const markRead = document.createElement("button");
            markRead.type = "button";
            markRead.className = "notification-item-read";
            markRead.textContent = "Mark read";
            markRead.setAttribute("aria-label", `Mark ${alert.title || "notification"} as read`);
            markRead.addEventListener("click", async () => {
              markRead.disabled = true;
              try {
                await profileApi.apiRequest(`/api/alerts/${alert.id}/read`, { method: "PATCH" });
                window.dispatchEvent(new CustomEvent("jalsaathi:notifications-changed"));
                await loadNotifications();
              } catch (error) {
                notificationFeedback.hidden = false;
                notificationFeedback.textContent = error instanceof Error
                  ? error.message
                  : "The notification could not be marked as read.";
                markRead.disabled = false;
              }
            });
            item.append(markRead);
          }
          notificationList.append(item);
        });
      } catch (error) {
        notificationList.replaceChildren();
        notificationEmpty.hidden = true;
        notificationFeedback.hidden = false;
        notificationFeedback.textContent = error instanceof Error
          ? error.message
          : "Notifications could not be loaded.";
      } finally {
        notificationLoadActive = false;
        notificationLoading.hidden = true;
      }
    };
    notificationButton.addEventListener("click", () => {
      const opening = notificationPanel.hidden;
      toggleMenu(notificationPanel, notificationButton, "#notification-panel");
      if (opening) void loadNotifications(true);
    });
    header.querySelector("[data-notification-more]").addEventListener("click", closeMenus);
    const notificationEvents = new AbortController();
    window.addEventListener("jalsaathi:notifications-changed", () => {
      void loadNotifications(notificationPanel.hidden === false);
    }, { signal: notificationEvents.signal });
    const notificationRefreshTimer = window.setInterval(() => {
      if (!document.hidden) void loadNotifications();
    }, 60_000);
    window.addEventListener("pagehide", () => {
      window.clearInterval(notificationRefreshTimer);
      notificationEvents.abort();
    }, { once: true });
    void loadNotifications();

    const enableBrowserPush = async () => {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("Browser notifications are not supported on this device.");
      }
      const keyResponse = await profileApi.apiRequest("/api/push/public-key");
      const publicKey = keyResponse.public_key;
      if (typeof publicKey !== "string" || !publicKey) {
        throw new Error("Browser notifications are not configured.");
      }
      const permission = await window.Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error(permission === "denied"
          ? "Notifications are blocked in browser settings."
          : "Browser notification permission was not granted.");
      }
      const registration = await navigator.serviceWorker.ready;
      const padding = "=".repeat((4 - publicKey.length % 4) % 4);
      const applicationServerKey = Uint8Array.from(
        atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + padding),
        (character) => character.charCodeAt(0),
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      window.dispatchEvent(new CustomEvent("jalsaathi:notifications-changed"));
      return true;
    };
    window.JalSaathiNotifications = {
      ...(window.JalSaathiNotifications || {}),
      enableBrowserPush,
    };

    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      enablePushButton.hidden = true;
    } else {
      enablePushButton.addEventListener("click", async () => {
        enablePushButton.disabled = true;
        notificationFeedback.hidden = false;
        notificationFeedback.textContent = "Requesting browser notification permission...";
        try {
          await enableBrowserPush();
          notificationFeedback.textContent = "Browser notifications are enabled.";
        } catch (error) {
          console.error("Could not enable JalSaathi browser notifications:", error);
          notificationFeedback.textContent = error instanceof Error
            ? error.message
            : "Browser notifications could not be enabled.";
        } finally {
          enablePushButton.disabled = false;
        }
      });
    }
    header.querySelectorAll("[data-chart-assistant-open], [data-install-app]")
      .forEach((button) => button.addEventListener("click", closeMenus));
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
    window.addEventListener("jalsaathi:auth-changed", () => {
      renderProfile();
      void loadNotifications(true);
    });
    window.addEventListener("jalsaathi:profile-changed", renderProfile);
  });
})();