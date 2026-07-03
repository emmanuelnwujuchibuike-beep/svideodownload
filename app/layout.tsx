import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { BootSplash } from "@/features/app-shell/boot-splash";
// import { AssistantWidget } from "@/features/assistant/assistant-widget"; // temporarily removed — re-add later
import { RegisterServiceWorker } from "@/features/notifications/register-sw";
import { WebVitals } from "@/features/perf/web-vitals";
import { SITE_URL as siteUrl } from "@/lib/site";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom-lock: prevents the mobile auto-zoom when focusing inputs (and pinch-zoom)
  // across the whole app, including the admin pages.
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080b14" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

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
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
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
        {/* Owner decision: SYSTEM is the default; the toggle offers
            light / dark / system and the user's choice is remembered. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Blue→purple gradient background with softly drifting glows — matches the marketing mockup. Premium + lightweight (GPU transforms only, paused for reduced-motion). */}
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
            {/* Base blue→purple wash — kept faint so pages read clean/white in
                light mode; the glows below carry the brand color. */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.06] via-violet-500/[0.04] to-purple-500/[0.07]" />
            {/* Blue glow — upper right, behind the hero phone */}
            <div className="absolute right-[-12%] top-[-6%] h-[72%] w-[62%] rounded-full bg-gradient-to-br from-sky-400/30 via-blue-500/20 to-violet-500/22 blur-[110px] will-change-transform motion-safe:animate-drift" />
            <div className="absolute right-[4%] top-[24%] h-[44%] w-[36%] rounded-full bg-gradient-to-tr from-cyan-300/28 to-blue-400/18 blur-[90px] will-change-transform motion-safe:animate-drift-slow" />
            {/* Violet accent — left */}
            <div className="absolute left-[-10%] top-[22%] h-[50%] w-[38%] rounded-full bg-gradient-to-r from-violet-500/18 to-transparent blur-[110px] will-change-transform motion-safe:animate-drift-slow" />
            {/* Purple wash — lower */}
            <div className="absolute bottom-[-12%] left-1/3 h-[46%] w-[55%] -translate-x-1/4 rounded-full bg-gradient-to-t from-purple-500/16 to-transparent blur-[100px] will-change-transform motion-safe:animate-drift" />
          </div>
          {children}
          {/* <AssistantWidget /> temporarily removed — re-add later */}
          {/* Ads are intentionally NOT global anymore — they live only on the
              marketing landing page. The app/social surfaces (home, feed,
              profiles, messages, …) are ad-free; social monetization comes later. */}
          <RegisterServiceWorker />
          <WebVitals />
        </ThemeProvider>
      </body>
    </html>
  );
}
