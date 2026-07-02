import type { MetadataRoute } from "next";

/**
 * PWA manifest — required for "Add to Home Screen" installs, and a hard
 * prerequisite for Web Push on iOS (Safari 16.4+ only delivers push to web apps
 * installed from the Home Screen with `display: standalone`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Frenz",
    short_name: "Frenz",
    description:
      "Download videos free, connect with friends, watch trending reels, and stay updated — all in one place.",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0a16",
    theme_color: "#0c0a16",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
