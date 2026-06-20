import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "About",
  description:
    "SVideoDownload is a fast, private, watermark-free downloader for TikTok and 1000+ platforms.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <PageShell
      title="About SVideoDownload"
      subtitle="The fastest, cleanest way to save the videos you love."
    >
      <p>
        SVideoDownload started with a simple frustration: downloading a video
        shouldn&apos;t mean dodging pop-ups, watermarks, fake buttons, and shady
        redirects. So we built the opposite — a downloader that feels like a
        premium product.
      </p>

      <h2>What we believe</h2>
      <ul>
        <li>
          <strong>Speed.</strong> Paste a link and get your file in seconds —
          backed by an advanced extraction engine and smart caching.
        </li>
        <li>
          <strong>Privacy.</strong> No account required. We don&apos;t store
          your files and collect as little data as possible.
        </li>
        <li>
          <strong>Simplicity.</strong> One clean input, a clear preview, and a
          single tap to download. Watermark-free, in HD.
        </li>
      </ul>

      <h2>Built for every platform</h2>
      <p>
        From TikTok, Instagram, and YouTube to X, Facebook, Pinterest, Vimeo,
        Reddit and 1000+ more — SVideoDownload supports the platforms you
        actually use, with audio extraction and quality selection built in.
      </p>

      <h2>What&apos;s next</h2>
      <p>
        We&apos;re continuously expanding platform support and polishing the
        experience — with accounts, synced history, and a native mobile app on
        the roadmap. Have a request? We&apos;d love to hear it.
      </p>

      <p>
        Questions or feedback? Reach us any time at{" "}
        <a href="mailto:hello@svideodownload.com">hello@svideodownload.com</a>.
      </p>
    </PageShell>
  );
}
