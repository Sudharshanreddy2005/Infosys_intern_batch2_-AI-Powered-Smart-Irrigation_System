"use client";

import { CropDiseaseLauncher } from "@/components/crop-disease-launcher";
import { AppShell } from "@/components/app-shell";
import { useI18n } from "@/components/i18n-provider";

export default function CropDiseasePage() {
  const { t } = useI18n();

  return (
    <AppShell>
      <section className="page-title">
        <p className="eyebrow">{t("FARM SUPPORT")}</p>
        <h1>{t("Crop disease detection")}</h1>
        <p className="muted">
          {t("This launcher opens the separate crop disease analysis service used for image-based diagnosis support.")}
        </p>
      </section>
      <CropDiseaseLauncher />
    </AppShell>
  );
}
