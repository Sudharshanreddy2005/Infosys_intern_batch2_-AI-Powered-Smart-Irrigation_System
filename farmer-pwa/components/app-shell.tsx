"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useFarmData } from "@/components/farm-data-provider";
import { useI18n } from "@/components/i18n-provider";
import { ErrorState, LoadingState, OfflineBanner } from "@/components/states";

const desktopNavigation = [
  { href: "/dashboard", label: "Home", icon: "⌂" },
  { href: "/fields", label: "Fields", icon: "♧" },
  { href: "/crops", label: "Crops", icon: "✿" },
  { href: "/schedule", label: "Schedule", icon: "▦" },
  { href: "/weather", label: "Weather", icon: "☼" },
  { href: "/alerts", label: "Alerts", icon: "ⓘ" },
  { href: "/profile", label: "Profile", icon: "◉" },
];

const mobileNavigation = desktopNavigation.filter((item) => item.href !== "/alerts");

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { data, loading, online, error, refreshing, refreshCooling, refresh, signOut } = useFarmData();
  const { t, formatDateTime } = useI18n();
  const [scheduleActionNotice, setScheduleActionNotice] = useState("");

  useEffect(() => {
    const navigateFromCache = (event: MouseEvent) => {
      if (navigator.onLine) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(destination.href);
    };
    document.addEventListener("click", navigateFromCache, true);
    return () => document.removeEventListener("click", navigateFromCache, true);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const showNotice = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail?.message !== "string") return;
      setScheduleActionNotice(event.detail.message);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setScheduleActionNotice(""), 5000);
    };
    window.addEventListener("jalsaathi:schedule-action", showNotice);
    return () => {
      window.removeEventListener("jalsaathi:schedule-action", showNotice);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (loading && !data) return <LoadingState />;
  if (!data) {
    return <main className="auth-page">{!online && <OfflineBanner />}<div className="auth-brand"><span className="brand-mark">J</span>JalSaathi</div><section className="auth-card">
      <h1>{t("Your farm information needs sign-in")}</h1>
      {error && <ErrorState>{t(error)}</ErrorState>}
      <p className="muted">{t("Sign in to see your saved farm information.")}</p>
      <Link className="primary-button button-link" href="/login">{t("Sign in")}</Link>
      <p className="auth-switch">{t("New to JalSaathi?")} <Link href="/register">{t("Create an account")}</Link></p>
    </section></main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/dashboard" aria-label={t("JalSaathi dashboard")}><span className="brand-mark" aria-hidden="true">J</span><span>JalSaathi</span></Link>
        <div className="topbar-actions">
          <span className={`connection ${online ? "is-online" : "is-offline"}`}><span aria-hidden="true" />{online ? t("Online") : t("Offline")}</span>
          <Link className={`icon-button alerts-button${pathname === "/alerts" ? " active" : ""}`} href="/alerts" prefetch={false} aria-label={t("Alerts")} aria-current={pathname === "/alerts" ? "page" : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
          </Link>
          <button className="icon-button refresh-button" type="button" onClick={() => void refresh()} disabled={!online || refreshing || refreshCooling} aria-label={t("Refresh farm data")}><span aria-hidden="true">{refreshing ? "…" : "↻"}</span><span className="refresh-label">{refreshing ? t("Refreshing…") : refreshCooling ? t("Refresh paused briefly") : t("Refresh")}</span></button>
          <details className="avatar-menu">
            <summary className="avatar" aria-label={t("Open account menu for {name}", { name: data.profile.name })}>
              {data.profile.name.trim().charAt(0).toUpperCase()}
            </summary>
            <div className="avatar-menu-panel">
              <Link href="/profile">{t("Profile")}</Link>
              <button type="button" onClick={() => void signOut()} disabled={!online}>{t("Sign out")}</button>
            </div>
          </details>
        </div>
      </header>
      <nav className="desktop-nav" aria-label={t("Main navigation")}>{desktopNavigation.map((item) => <NavLink key={item.href} {...item} label={t(item.label)} online={online} current={isCurrentRoute(pathname, item.href)} />)}</nav>
      <main className="content">
        {!online && <OfflineBanner lastUpdated={data.lastUpdated} />}
        {error && online && <ErrorState>{t(error)}</ErrorState>}
        {scheduleActionNotice && <p className="notice schedule-action-notice" role="status">{scheduleActionNotice}</p>}
        {children}
        <footer className="page-footer"><span>JalSaathi · {t("Smart Irrigation")}</span><span>{t("Last updated {date}", { date: formatDateTime(data.lastUpdated) })}</span></footer>
      </main>
      <nav className="mobile-nav" aria-label={t("Main navigation")}>{mobileNavigation.map((item) => <NavLink key={item.href} {...item} label={t(item.label)} online={online} current={isCurrentRoute(pathname, item.href)} />)}</nav>
    </div>
  );
}

function isCurrentRoute(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

function NavLink({ href, label, icon, current, online }: { href: string; label: string; icon: string; current: boolean; online: boolean }) {
  const className = `nav-link${current ? " active" : ""}`;
  const content = <><span className="nav-icon" aria-hidden="true">{icon}</span><span className="nav-label">{label}</span></>;
  if (!online) return <a className={className} href={href} aria-current={current ? "page" : undefined}>{content}</a>;
  return <Link className={className} href={href} prefetch={false} aria-current={current ? "page" : undefined}>{content}</Link>;
}
