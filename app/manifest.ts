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
    /*
      🔴 `id` stays "/home" — it is the app's IDENTITY, not its entry point.
      Changing it makes the browser treat this as a DIFFERENT app: every
      existing installation is orphaned, push subscriptions detach, and the user
      ends up with two Frenz icons. `start_url` may move freely; `id` may not.
    */
    id: "/home",
    /*
      🔴 The cold-entry loader (owner, 2026-08-11: "make a separate premium cold
      entry loader like tiktok and X").

      Every other candidate entry is `force-dynamic` behind auth, so its first
      byte is 0.66–2.3 seconds away — measured live — and until then the launch
      is a white screen that no in-document loader can cover.

      `/launch.html` is a hand-written static file in `public/`, NOT a Next
      route. That distinction is the whole fix: a Next route inherits the root
      layout and its two render-blocking stylesheets, so the loader would still
      wait on the network. This document has zero subresources — inline CSS, the
      logo as a data URI, no framework — so it paints on arrival, and the
      service worker serves it from disk on every launch after the first. It
      then hands off to the viewer's real home.

      It shows ONLY in an installed display mode (a CSS `display-mode` guard in
      the file), so a browser can never see it — owner, 2026-08-11.
    */
    start_url: "/launch.html",
    scope: "/",
    lang: "en",
    dir: "ltr",
    display: "standalone",
    // Chrome/Edge fall back down this list to the first mode they support —
    // "standalone" (already the `display` field above) is the universal
    // fallback, listed last on purpose.
    display_override: ["standalone"],
    orientation: "portrait",
    categories: ["social", "entertainment", "photo", "video"],
    // Client-mode "navigate-existing": relaunching an already-open installed
    // app (tapping the home-screen icon again, or a notification/share)
    // reuses the existing window/tab instead of opening a duplicate one.
    launch_handler: { client_mode: "navigate-existing" },
    // Lets a shared link (e.g. "Share" from TikTok/Instagram) hand its URL
    // straight to Frenz instead of the user having to copy/paste it — see
    // the receiving side in app/page.tsx + features/downloader/downloader.tsx.
    share_target: {
      action: "/",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    shortcuts: [
      {
        name: "Download a video",
        short_name: "Download",
        url: "/#download",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Reels",
        url: "/reels",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Messages",
        url: "/messages",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Search",
        url: "/search",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
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
      { src: "/icon-1024.png", sizes: "1024x1024", type: "image/png" },
      // Real safe-zone-padded asset (regenerated via scripts/gen-icons.mjs) —
      // was previously byte-identical to icon-512.png, so Android clipped the
      // glyph on every circular/squircle adaptive-icon mask. See PWA audit.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
