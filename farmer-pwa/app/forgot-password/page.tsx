"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";

export default function Page() {
  const { t } = useI18n();
  return <main className="auth-page"><section className="auth-card"><h1>{t("Password reset not available")}</h1><p className="muted">{t("Password recovery is not connected to the backend. Contact support for assistance.")}</p><Link className="touch-link" href="/login">{t("Back to sign in")}</Link></section></main>;
}
