import { MotionConfig } from "framer-motion";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeCacheSync } from "@/components/theme-cache-sync";
import { ThemeProvider } from "@/components/theme-provider";
import { BootHead, BootSplash, ThemeBootScript } from "@/features/app-shell/boot-splash";
import { EdgeSwipeBack } from "@/features/app-shell/edge-swipe-back";
import { GlobalErrorCapture } from "@/features/app-shell/global-error-capture";
import { OfflineBanner } from "@/features/app-shell/offline-banner";
import { StatusBarScrim } from "@/features/app-shell/status-bar-scrim";
// import { AssistantWidget } from "@/features/assistant/assistant-widget"; // temporarily removed — re-add later
import { RegisterServiceWorker } from "@/features/notifications/register-sw";
import { ScrollPerfMonitor } from "@/features/perf/scroll-perf-monitor";
import { WebVitals } from "@/features/perf/web-vitals";
import { SITE_URL as siteUrl } from "@/lib/site";

import "./globals.css";

// Owner ask (2026-07-10): "a premium human font like snapchat and tiktok
// font." Their actual fonts (Graphik/TikTok Sans) are proprietary; Plus
// Jakarta Sans is the closest freely-licensed match to that same modern,
// rounded-humanist-geometric feel — a common stand-in for exactly this brief
// in premium consumer apps. Wired through the SAME `--font-sans` variable
// Inter used, so every page inherits it automatically via Tailwind's
// `font-sans` (no per-component changes needed).
const displaySans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });

// ISR: static pages (incl. the global footer's admin-managed Recommended Tools)
// regenerate at most once a minute, so monetization changes go live without a
// redeploy. Dynamic pages (/admin, /account, /login) set their own config.
export const revalidate = 60;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Download Videos Online Free | Frenzsave",
    template: "%s · FrenzSave",
  },
  description:
    "Download videos online for free, connect with new friends, watch trending reels, and stay updated with the latest news—all in one place.",
  keywords: [
    "tiktok downloader",
    "no watermark",
    "video downloader",
    "instagram downloader",
    "youtube downloader",
    "mp4 download",
    "mp3 download",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "FrenzSave",
    title: "Download Videos Online Free | Frenzsave",
    description:
      "Download videos online for free, connect with new friends, watch trending reels, and stay updated with the latest news—all in one place.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Download Videos Online Free | Frenzsave",
    description:
      "Download videos online for free, connect with new friends, watch trending reels, and stay updated with the latest news—all in one place.",
  },
  robots: { index: true, follow: true },
  // Home-screen install identity (iOS). With app/manifest.ts + app/apple-icon.png
  // this is what makes "Add to Home Screen" produce a real standalone app — the
  // prerequisite for Web Push on iPhone/iPad (Safari 16.4+).
  appleWebApp: { capable: true, title: "Frenz", statusBarStyle: "black-translucent" },
  // iOS auto-links number-shaped text (phone numbers, dates, addresses,
  // emails) into tap-to-call/tap-to-mail chips — undesirable inside feed/
  // profile/comment text that isn't actually contact info.
  formatDetection: { telephone: false, date: false, address: false, email: false },
  other: {
    // Chromium's non-Apple-prefixed equivalent of `appleWebApp.capable` above
    // — `appleWebApp` only emits the `apple-mobile-web-app-*` tags, Next has
    // no first-class field for this one yet.
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom-lock: prevents the mobile auto-zoom when focusing inputs (and pinch-zoom)
  // across the whole app, including the admin pages.
  maximumScale: 1,
  userScalable: false,
  // Edge-to-edge in the installed app: with statusBarStyle black-translucent
  // this lets reels/photos draw UNDER the clock/battery/notch (TikTok-style
  // full bleed). It's also what makes env(safe-area-inset-*) return real
  // values — without it iOS letterboxes below the status bar and every
  // safe-area padding in the app evaluates to zero.
  viewportFit: "cover",
  // Standards-based fix for "the keyboard covers the fixed bottom nav /
  // composer" (iOS 17.4+, Chrome 108+): makes the LAYOUT viewport itself
  // shrink when the on-screen keyboard opens, so `100dvh` containers and
  // `position: fixed` elements (MobileNav, sheet footers) correctly reflow
  // above it instead of being hidden behind it. Falls back to the old
  // "resizes-visual" behavior (content pans under a fixed keyboard-covered
  // viewport) on older engines — no regression there, just no improvement.
  interactiveWidget: "resizes-content",
  // #050816 matches globals.css's actual dark --background exactly (was
  // #080b14 — a slightly different near-black that never matched anything
  // else in the app, a small but real inconsistency found while auditing
  // every dark-color source for the boot-flash investigation).
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#050816" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

// Native iOS launch-screen images ("apple-touch-startup-image") — confirmed
// absent before this fix. iOS shows its OWN splash BEFORE any of our JS/CSS
// runs (including the theme-aware BootSplash), auto-generating a plain WHITE
// one when no custom image is provided — so a dark-theme user saw a white
// flash on literally every launch of the installed app, no in-page fix could
// ever prevent it. Curated to the highest-population active iPhone sizes
// (not exhaustive — iPad + older/rarer models fall back to iOS's default
// plain splash, an honest, documented scoping choice). `media` must match
// each device's CSS device-width/height + pixel ratio exactly for iOS to
// pick the right file; images generated via scratchpad's gen-splash.mjs
// (solid brand background + the existing frenz-logo.png centered).
const SPLASH_SCREENS: { file: string; width: number; height: number; ratio: number }[] = [
  { file: "1170x2532", width: 390, height: 844, ratio: 3 }, // iPhone 12/13/14
  { file: "1179x2556", width: 393, height: 852, ratio: 3 }, // iPhone 14 Pro/15/16
  { file: "1284x2778", width: 428, height: 926, ratio: 3 }, // Pro Max / Plus
  { file: "1290x2796", width: 430, height: 932, ratio: 3 }, // Pro Max (newest)
  { file: "1125x2436", width: 375, height: 812, ratio: 3 }, // X/XS/11 Pro/12 mini/13 mini
  { file: "750x1334", width: 375, height: 667, ratio: 2 }, // SE
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "FrenzSave",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description:
    "Watermark-free video downloader for TikTok, Instagram, YouTube and more.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Theme class MUST be set from <head>, before any first paint — a
            <body> placement leaves a paint window on streamed responses
            where the empty body flashes the default light background for
            dark users (see boot-splash.tsx's THEME_JS comment). */}
        <ThemeBootScript />
        {/* Boot-splash STYLE + dismissal DECISION — also in <head>, before
            first paint, so a streamed force-dynamic page (e.g. /messages)
            can't paint the F splash and then leave it up for seconds waiting
            on the hide-script in a later body chunk. See BootHead's comment. */}
        <BootHead />
        {/* app/apple-icon.png (180x180) already auto-emits the primary
            apple-touch-icon link via Next's file convention — modern iOS
            scales that single image fine. These two are legacy-size
            fallbacks (older iPad/iPhone guidance) generated alongside it by
            scripts/gen-icons.mjs; harmless to include, not load-bearing. */}
        <link rel="apple-touch-icon" sizes="152x152" href="/apple-icon-152.png" />
        <link rel="apple-touch-icon" sizes="167x167" href="/apple-icon-167.png" />
        {/* BootSplash (below) renders this as a raw <img> before React/next-image
            ever runs — preload it so the boot logo paints immediately on every
            cold load instead of waiting on a cache-cold fetch. */}
        <link rel="preload" as="image" href="/brand/frenz-logo.png" fetchPriority="high" />
        {SPLASH_SCREENS.flatMap(({ file, width, height, ratio }) =>
          (["light", "dark"] as const).map((theme) => (
            <link
              key={`${theme}-${file}`}
              rel="apple-touch-startup-image"
              href={`/splash/${theme}-${file}.png`}
              media={`(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${theme})`}
            />
          )),
        )}
      </head>
      <body className={`${displaySans.variable} font-sans`}>
        {/* Branded boot loader baked into the first HTML so cold entries never
            flash an empty page; it fades itself out once the document is ready. */}
        <BootSplash />
        {/* One-time cleanup (runs before the next-themes bootstrap): an earlier
            build force-migrated visitors to "dark". Owner decision: the default
            is SYSTEM; users pick light/dark themselves. Undo that forced value
            once (flag-guarded so explicit choices made afterwards stick). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(!localStorage.getItem("frenz:theme-reset")){if(localStorage.getItem("theme")==="dark")localStorage.removeItem("theme");localStorage.setItem("frenz:theme-reset","1")}}catch(e){}`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Owner decision, CHANGED 2026-07-16: LIGHT is now the default for a
            brand-new visitor (was "system"). `enableSystem` deliberately STAYS
            on — that's what keeps "System" available as a real choice in the
            toggle for anyone who wants it; it just isn't what you get by
            default any more. This is one of THREE layers that must agree or the
            theme flashes on boot — see the note on `readInitial` in
            lib/theme/theme-mode-client.ts for the other two. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeCacheSync />
          {/* App-wide reduced-motion: every framer-motion animation anywhere in
              the app (hundreds of hand-authored transitions across dozens of
              files) automatically respects the OS/browser "reduce motion"
              setting from here — x/y/scale/rotate collapse to instant, opacity
              fades still play, with zero per-component opt-in required. This
              is Frenz Motion's accessibility baseline; individual components
              can still layer their own `prefers-reduced-motion` handling
              (e.g. pausing a decorative loop) on top where needed. */}
          <MotionConfig reducedMotion="user">
            {/* Owner ask (2026-07-15): remove the purple/blue ambient wash
                everywhere — messages, profile, friends, home, every page —
                in favor of a flat, pure background. This decoration was the
                recurring source of the "light purple background bleed"
                reports on individual pages (patched piecemeal there before);
                removing it at the ROOT means every page gets a genuinely
                flat bg-background with nothing to bleed through, instead of
                each page needing its own opaque cover for this one shared
                decoration. Kept as a plain filled div (not deleted outright)
                so nothing behind app content is ever transparent. */}
            <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-background" />
            {children}
            {/* <AssistantWidget /> temporarily removed — re-add later */}
            {/* Ads are intentionally NOT global anymore — they live only on the
                marketing landing page. The app/social surfaces (home, feed,
                profiles, messages, …) are ad-free; social monetization comes later. */}
            <RegisterServiceWorker />
            <GlobalErrorCapture />
            <StatusBarScrim />
            <EdgeSwipeBack />
            <OfflineBanner />
            <WebVitals />
            <ScrollPerfMonitor />
          </MotionConfig>
        </ThemeProvider>
      </body>
    </html>
  );
}
