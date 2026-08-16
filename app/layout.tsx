import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeCacheSync } from "@/components/theme-cache-sync";
import { ThemeProvider } from "@/components/theme-provider";
import { BootHead, BootSplash, ThemeBootScript } from "@/features/app-shell/boot-splash";
import { DeferredShell } from "@/features/app-shell/deferred-shell";
import { LocaleBootScript } from "@/components/i18n/locale-boot-script";
import { A11yBootScript, A11yColorFilters } from "@/components/a11y/a11y-boot-script";
// import { AssistantWidget } from "@/features/assistant/assistant-widget"; // temporarily removed — re-add later
import { AdSenseSiteScript, VerificationTags } from "@/features/monetization/adsense-site-script";
import { GoogleTag } from "@/features/monetization/google-tag";
import { MonetagScript } from "@/features/monetization/monetag-script";
import { DEFAULT_LOCALE, getLocale, isRtl } from "@/lib/i18n/locales";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

import "./globals.css";

/*
 * Inter — restored 2026-07-19.
 *
 * History: Inter → Plus Jakarta Sans (`d1016da`, 2026-07-10) on the ask for "a
 * premium human font like snapchat and tiktok font". Reverted on the owner's
 * follow-up: Plus Jakarta's rounded, wide-aperture geometry reads informal at UI
 * sizes, which is the "unprofessional" they were pointing at.
 *
 * Why Inter is also the right answer to "use the Snapchat font": Snapchat's is
 * Graphik (Commercial Type). It is proprietary — a basic single-style web licence
 * starts around $50 and the full collection is ~$1,500, priced per monthly unique
 * visitor, so it cannot simply be dropped into a public repo. Inter is the closest
 * freely-licensed match (commonly cited at ~88% similarity) and shares Graphik's
 * whole design intent: Christian Schwartz called Graphik "emphatically vanilla",
 * a sans whose job is to not be noticed, and Inter occupies exactly that territory
 * in the open-source world.
 *
 * So both halves of the request — "restore the previous font" and "use the
 * Snapchat font" — converge on Inter.
 *
 * Wired through the same `--font-sans` variable, so every surface inherits it via
 * Tailwind's `font-sans` with no per-component change.
 */
const displaySans = Inter({ subsets: ["latin"], variable: "--font-sans" });

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
  //
  // statusBarStyle "black-translucent": the app draws edge-to-edge UNDER the
  // status bar (TikTok-style) and each top chrome pads itself clear of the clock/
  // battery. The REAL fix for "content pushes too much to the top on every page
  // in the webapp" (owner, 2026-07-21, reported twice) was NOT this style — I
  // briefly tried "default" and it didn't help — it's that current iOS reports
  // `env(safe-area-inset-top)` as 0 in an installed standalone PWA, so every
  // `pt-[env(safe-area-inset-top)]` collapsed to nothing. That inset is now routed
  // through the `--frenz-safe-top` variable (globals.css), which floors it at 44px
  // in standalone mode so content always clears the bar even when iOS reports 0.
  // Staying on black-translucent (what the installed app already runs — the
  // status-bar style is cached at INSTALL time) means this CSS-only fix lands with
  // NO reinstall; CSS is re-read on every launch.
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
  /*
    🔴 ZOOM IS ALLOWED AGAIN (owner, 2026-08-10: accessibility is "the crucial
    part"; Lighthouse a11y sat at 82).

    This was `maximumScale: 1, userScalable: false`, to stop iOS auto-zooming
    when an input is focused. It worked, and it did so by taking pinch-zoom away
    from everybody on every page — including the admin.

    That is a WCAG 2.1 SC 1.4.4 (Resize Text) failure and Lighthouse audits it
    by name. It is also the single most user-hostile accessibility default a
    site can ship: someone who needs to magnify a paragraph to read it cannot,
    and there is no setting anywhere that gives it back. Our own Accessibility
    Center (Part 22) offers a text-size control while this line was quietly
    overriding the platform's own.

    The auto-zoom it was preventing has a correct fix, and it is a font size,
    not a lock: iOS zooms only when a focused field's text is under 16px. That
    is now handled in globals.css for coarse pointers, which solves the actual
    problem without confiscating the gesture.
  */
  // viewportFit "cover" — content draws edge-to-edge (owner: "everything else can
  // go totally up except buttons, icons and logos"; reels/media stay full-bleed).
  // The chrome that must NOT go under the status bar (topbar, buttons, icons,
  // logos, reel controls) pads itself by var(--frenz-safe-top). Because current
  // iOS reports env(safe-area-inset-top) as 0 in a standalone PWA — and
  // @media (display-mode: standalone) proved unreliable there too — that variable
  // is floored to 44px via a JS-set `html.pwa-standalone` class (the inline script
  // in <head> below + globals.css), which reads `navigator.standalone`, the signal
  // iOS actually honours. So content is full-bleed and only the chrome comes down.
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

/*
  🔴 Sitewide Organization + WebSite added, and this whole block routed through
  the shared `jsonLd()` XSS-safe serializer (2026-08-16 SEO audit).

  Before this, `Organization`/`WebSite` only ever appeared NESTED as a
  `publisher`/`provider`/`isPartOf` fragment on individual content types
  (blog posts, help articles, topic pages) — there was no single top-level
  entity search engines could resolve the brand itself to, and no
  `SearchAction`, which is what makes a sitelinks search box eligible.

  Every field below is real and checkable: `logo` points at an actual file in
  `public/`, `url` is the real canonical origin. No `sameAs` — this project
  does not fabricate data it cannot verify (see lib/seo/wallpapers.ts's "no
  invented star rating" note, same principle), and no live, confirmed social
  profile URLs were found in this codebase to link. Add it only once one
  genuinely exists.

  This was also previously serialized with a raw `JSON.stringify`, not the
  `jsonLd()` helper every other structured-data block in the app uses
  (`docs/SECURITY.md`'s documented sitewide rule) — harmless while every field
  here is a static literal, but the kind of inconsistency that becomes a real
  gap the next time this block is extended with anything dynamic.
*/
const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${siteUrl}/#organization`,
  name: "FrenzSave",
  url: siteUrl,
  logo: `${siteUrl}/icon-512.png`,
};

const websiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${siteUrl}/#website`,
  name: "FrenzSave",
  url: siteUrl,
  publisher: { "@id": `${siteUrl}/#organization` },
  /*
    No `potentialAction`/`SearchAction`. The wallpaper search box (the only
    search on the site) is client-state, not a `?q=` URL a bot could actually
    drive — declaring a SearchAction against a URL that doesn't honor it
    would be exactly the misleading-schema problem this audit is fixing
    elsewhere. Add this back if/when a query param genuinely drives a search.
  */
};

const webApplicationLd = {
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
    /*
      lang/dir come from the locale registry, not from two literals.

      They were hardcoded `en`/`ltr`, which is correct today and silently wrong
      the moment Arabic ships: `dir` drives the browser's own bidi algorithm, so
      a stale `ltr` mis-renders every RTL page no matter how good the translation
      is. Deriving both from one place means the first RTL locale flips the
      document without anyone remembering this file exists.

      Still a build-time constant — `DEFAULT_LOCALE` is resolved statically, so
      this does not read request state and cannot un-static the marketing routes.
    */
    <html
      lang={getLocale(DEFAULT_LOCALE)?.bcp47 ?? "en"}
      dir={isRtl(DEFAULT_LOCALE) ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <head>
        {/* Standalone (installed-PWA) detection, set BEFORE first paint so the
            top-inset variable (--frenz-safe-top, globals.css) is already floored
            when the chrome lays out — no reflow. Driven by `navigator.standalone`
            (the signal iOS actually honours) because @media (display-mode:
            standalone) proved unreliable in the installed app, which is why the
            buttons kept jamming under the status bar. Deliberately NOT applied to
            the plain iOS browser — env() is already correct (adaptive) there, and
            flooring it fattened the landing header. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches;if(s||navigator.standalone===true){document.documentElement.classList.add('pwa-standalone')}}catch(e){}})();`,
          }}
        />
        {/* Theme class MUST be set from <head>, before any first paint — a
            <body> placement leaves a paint window on streamed responses
            where the empty body flashes the default light background for
            dark users (see boot-splash.tsx's THEME_JS comment). */}
        <ThemeBootScript />
        {/* Language + text DIRECTION, same reasoning as the theme above: the
            landing is statically prerendered so the server cannot know the
            locale, and Arabic rendered inside an LTR document is worse than
            English. Setting it here makes the first paint correct instead of
            reflowing the whole page after hydration. */}
        <LocaleBootScript />
        {/* Accessibility preferences — text scale, contrast, motion, targets.
            In <head> for the same reason as the two above: someone who set 150%
            text because they cannot read the default must not be shown the
            default first and a reflow second. Runs offline, needs no bundle. */}
        <A11yBootScript />
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
        <link rel="preload" as="image" href="/brand/frenz-logo-splash.png" fetchPriority="high" />
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
        {/*
          The AdSense SITE-LEVEL script.

          This is the snippet AdSense hands you to verify a site and to run Auto
          ads — publisher id, no slot, renders nothing on its own. It is distinct
          from an ad UNIT (which also carries a slot id and renders in a
          placement), and it must be here in `<head>` on every page: Google's
          verification crawler reads the server-rendered HTML, so injecting it
          later from the client would leave the site unverifiable.

          Server-rendered rather than `next/script` for the same reason — it has
          to be in the first byte of the document, not added after hydration.
          Emitted only when a publisher id is configured, so a site that has not
          set one up ships no third-party script at all.
        */}
        <AdSenseSiteScript />
        {/* Ownership verification for any network that offers a meta-tag method —
            which is the method this site supports, because the FILE method
            collides with the PWA service worker at /sw.js. */}
        <VerificationTags />
        {/* GA4 / Google Ads / Tag Manager, from an admin-set ID. */}
        <GoogleTag />
      </head>
      <body className={`${displaySans.variable} font-sans`}>
        {/* Monetag (site-wide) — the owner's network alongside AdSense. The admin
            snippets are parsed server-side into safe tags, then injected on the
            client ONLY for visitors who should see ads, so Pro/Business stay
            ad-free without un-static-ing the marketing pages. Lives in <body>
            because it renders no server markup — it injects into <head> itself. */}
        <MonetagScript />
        {/* Branded boot loader baked into the first HTML so cold entries never
            flash an empty page; it fades itself out once the document is ready. */}
        <BootSplash />
        {/* Colour-blindness filter matrices — `filter: url(#…)` can only
            reference a filter present in the document. Hidden, zero-size, and
            costs no JavaScript. */}
        <A11yColorFilters />
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
          dangerouslySetInnerHTML={{
            __html: jsonLd([organizationLd, websiteLd, webApplicationLd]),
          }}
        />
        {/* Owner decision, REVERTED 2026-08-16: SYSTEM is the default for a
            brand-new visitor again (was "light" since 2026-07-16 — see the
            full explanation on `readInitial` in lib/theme/theme-mode-client.ts
            for why that interim change is safe to undo now). `enableSystem`
            was already on either way. This is one of THREE layers that must
            agree or the theme flashes on boot — see that same note for the
            other two. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ThemeCacheSync />
          {/*
            MotionConfig lives in the (app) layout, NOT here.

            Importing it at the ROOT put framer-motion — 39 kB gzipped — into
            every page's first load, including the landing, whose whole budget
            is 305 kB and which uses no framer animation at all. The marketing
            tree is CSS-animated throughout (see `.frenz-cta`, the nav lift and
            the theme pill), so it was paying for a library it never called.

            The app tree still gets the identical accessibility baseline —
            every framer transition there collapses under "reduce motion" with
            no per-component opt-in — because that is where the provider now
            sits, wrapping every route that actually animates with it.
          */}
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
            {/*
              ⌘K, the service worker, error capture, web vitals and the
              analytics tracker — all mounted one paint LATER (see
              DeferredShell). They were hydrating inside the first task on every
              page, and this landing's LCP is gated on that task finishing.
            */}
            <DeferredShell />
            {/* <AssistantWidget /> temporarily removed — re-add later */}
            {/* Ads are intentionally NOT global anymore — they live only on the
                marketing landing page. The app/social surfaces (home, feed,
                profiles, messages, …) are ad-free; social monetization comes later. */}
        </ThemeProvider>
      </body>
    </html>
  );
}
