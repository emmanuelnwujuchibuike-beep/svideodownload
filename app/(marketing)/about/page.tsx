import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";
import { withSocial } from "@/lib/seo/page-metadata";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

export const metadata: Metadata = withSocial({
  title: "About",
  description:
    "Who runs Frenzsave and why: a fast, private way to save public videos in original quality — to back up your own posts, watch offline and keep an archive.",
  alternates: { canonical: "/about" },
});

/*
  🔴 OWNER: replace every bracketed value below before the site is deployed or submitted for review (2026-10-29).
  A visible "[Year founded]" is worse than no line at all.
*/
const COMPANY = "[Company/owner name]";
const LOCATION = "[Country/city]";
const FOUNDED = "[Year founded]";
const FOUNDER = "[Founder name]";
const FOUNDER_BIO = "[Short founder bio — one or two sentences about who they are and why they built Frenzsave.]";
/** The address the Contact page lists for support — shown as plain text so readers and reviewers can see it. */
const CONTACT_EMAIL = "support@frenzsave.com";

export default function AboutPage() {
  return (
    <PageShell
      title="About Frenzsave"
      subtitle="A fast, private way to keep the videos that matter to you."
    >
      <p>
        Frenzsave started with a simple frustration: saving a video shouldn&apos;t
        mean dodging pop-ups, fake buttons and shady redirects. So we built the
        opposite — a clean tool that feels like a premium product.
      </p>

      <h2>Who we are</h2>
      <p>
        Frenzsave is run by {COMPANY}, based in {LOCATION}, and has been building
        since {FOUNDED}.
      </p>
      <p>
        <strong>{FOUNDER}</strong> — {FOUNDER_BIO}
      </p>

      <h2>What we believe</h2>
      <ul>
        <li>
          <strong>Speed.</strong> Paste a link and get your file in seconds —
          backed by an advanced extraction engine and smart caching.
        </li>
        <li>
          <strong>Privacy.</strong> No account required to save a video. We
          don&apos;t store your files and collect as little data as possible.
        </li>
        <li>
          <strong>Simplicity.</strong> One clean input, a clear preview, and a
          single tap to save — in the original quality.
        </li>
        <li>
          <strong>Respect for creators.</strong> Frenzsave is for backing up your
          own posts, watching offline, archiving and accessibility. Only save
          content you own or have permission to use, and respect the creator&apos;s
          rights and the platform&apos;s terms.
        </li>
      </ul>

      <h2>Built for every platform</h2>
      <p>
        From TikTok and Instagram to X, Facebook, Pinterest, Vimeo, Reddit,
        LinkedIn and Threads — Frenzsave supports the platforms you actually
        use, with audio extraction and quality selection built in.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or feedback? Email us at {CONTACT_EMAIL}. For copyright notices,
        see our <Link href="/dmca">DMCA page</Link>.
      </p>
    </PageShell>
  );
}
