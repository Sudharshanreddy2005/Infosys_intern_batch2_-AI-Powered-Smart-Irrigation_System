import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "JalSaathi Farmer",
    short_name: "JalSaathi",
    description: "Your fields and irrigation schedule, even when you are offline.",
    lang: "en",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f3",
    theme_color: "#174c35",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Today's irrigation",
        short_name: "Irrigation",
        url: "/schedule",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Fields",
        short_name: "Fields",
        url: "/fields",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
