import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistration from "@/components/service-worker-registration";
import { InstallExperience } from "@/components/install-experience";
import { FarmDataProvider } from "@/components/farm-data-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "JalSaathi",
  title: "JalSaathi | Smart Irrigation",
  description: "Your farm information and irrigation schedule, online or offline.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "JalSaathi", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta id="theme-color" name="theme-color" content="#f5f7f3" />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var choice=localStorage.getItem("jalsaathi-theme");var dark=choice==="dark"||(choice!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=dark?"dark":"light";var meta=document.getElementById("theme-color");if(meta)meta.content=dark?"#121a16":"#f5f7f3";var lang=localStorage.getItem("jalsaathi-language")||navigator.language.split("-")[0];document.documentElement.lang=["en","te","hi","kn","ta","ml"].includes(lang)?lang:"en";}catch(error){console.warn("JalSaathi preferences could not be restored before paint.",error);document.documentElement.dataset.theme="light";document.documentElement.lang="en";}})();` }} />
      </head>
      <body>
        <ServiceWorkerRegistration />
        <ThemeProvider>
          <I18nProvider>
            <InstallExperience />
            <FarmDataProvider>{children}</FarmDataProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
