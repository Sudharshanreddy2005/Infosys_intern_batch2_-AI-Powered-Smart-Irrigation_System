(() => {
  "use strict";

  let initialized = false;
  const initializeSidebar = () => {
    if (initialized) return;
    const sidebar = document.getElementById("sidebar-navigation");
    const toggle = document.querySelector(".menu-toggle, .portal-menu-toggle, .common-topbar-menu");
    const overlay = document.querySelector(".sidebar-overlay, .portal-sidebar-overlay");
    const mobileQuery = window.matchMedia("(max-width: 860px)");
    if (!(sidebar instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement) ||
        !(overlay instanceof HTMLButtonElement)) return;
    initialized = true;

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
      link.addEventListener("click", () => closeMenu({ restoreFocus: false }));
    });

    document.addEventListener("keydown", (event) => {
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
  };

  window.addEventListener("jalsaathi:topbar-mounted", initializeSidebar, { once: true });
  document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector(".common-topbar-menu, .menu-toggle, .portal-menu-toggle")) initializeSidebar();
  });
})();
