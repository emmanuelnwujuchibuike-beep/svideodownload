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
    // Static values — the manifest can't read the user's saved light/dark
    // pick or even the OS media query, unlike app/layout.tsx's conditional
    // `viewport.themeColor`. This is what the OS paints its OWN native splash
    // screen and status-bar tint from on EVERY launch/resume of the installed
    // app, before any of our page's HTML/CSS/JS (incl. the theme-aware
    // BootSplash) has run — hardcoding the dark color here made every reentry
    // flash dark chrome even for someone who explicitly picked Light. Neutral
    // white matches BootSplash's own default rest-state (see boot-splash.tsx).
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
