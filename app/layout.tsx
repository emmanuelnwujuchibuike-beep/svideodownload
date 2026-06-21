import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { SITE_URL as siteUrl } from "@/lib/site";

import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SVideoDownload — Download TikTok & 1000+ Platform Videos",
    template: "%s · SVideoDownload",
  },
  description:
    "Fast, secure, watermark-free video downloads from TikTok, Instagram, YouTube, X and 1000+ platforms. No login. Unlimited downloads in HD.",
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
    siteName: "SVideoDownload",
    title: "Download TikTok & 1000+ Platform Videos — Watermark Free",
    description:
      "Fast, secure, watermark-free downloads powered by advanced media extraction technology.",
  },
  twitter: {
    card: "summary_large_image",
    title: "SVideoDownload — Watermark-Free Video Downloader",
    description: "Download from TikTok, Instagram, YouTube and 1000+ platforms.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a14" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "SVideoDownload",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description:
    "Watermark-free video downloader for TikTok and 1000+ platforms powered by yt-dlp.",
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
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
