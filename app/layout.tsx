import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { AssistantWidget } from "@/features/assistant/assistant-widget";
import { AdScripts } from "@/features/monetization/ad-scripts";
import { StickyBottomAd } from "@/features/monetization/sticky-bottom-ad";
import { SITE_URL as siteUrl } from "@/lib/site";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom-lock: prevents the mobile auto-zoom when focusing inputs (and pinch-zoom)
  // across the whole app, including the admin pages.
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a14" },
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* Fixed gradient background — pinned to viewport, behind all content, seamless on every page */}
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
            {/* Blue — top center */}
            <div className="absolute left-1/2 top-[-8%] h-[65%] w-[80%] -translate-x-1/2 rounded-full bg-gradient-to-b from-blue-600/30 via-sky-500/15 to-transparent blur-[90px]" />
            {/* Gold — top right */}
            <div className="absolute right-[-4%] top-[-4%] h-[55%] w-[48%] rounded-full bg-gradient-to-bl from-amber-500/30 via-orange-400/15 to-transparent blur-[80px]" />
            {/* Cyan — bottom left */}
            <div className="absolute bottom-[-4%] left-[-4%] h-[55%] w-[48%] rounded-full bg-gradient-to-tr from-cyan-500/26 to-transparent blur-[80px]" />
            {/* Violet — mid left */}
            <div className="absolute left-[-4%] top-[38%] h-[45%] w-[38%] rounded-full bg-gradient-to-r from-violet-600/18 to-transparent blur-[75px]" />
            {/* Extra: rose — bottom right */}
            <div className="absolute bottom-[-4%] right-[-4%] h-[45%] w-[40%] rounded-full bg-gradient-to-tl from-rose-500/14 to-transparent blur-[80px]" />
          </div>
          {children}
          <AssistantWidget />
          <StickyBottomAd />
          <AdScripts />
        </ThemeProvider>
      </body>
    </html>
  );
}
