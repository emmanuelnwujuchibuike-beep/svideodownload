import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { GuestLibrary } from "@/features/downloads/guest-library";

/**
 * `/library` — the public, signed-out download library.
 *
 * DELIBERATELY STATIC. The whole page is prerendered and served from the CDN;
 * everything that varies per visitor (their history, usage and the 5 GB meter)
 * is read from localStorage on the client by GuestLibrary. That is what makes it
 * open instantly with no loading state — the brief's "prefetch immediately so it
 * doesn't load at all". Adding any request-time read here (cookies, auth,
 * searchParams) would un-static it and reintroduce the origin round-trip we are
 * avoiding, so this file touches none.
 *
 * The signed-in Downloads dashboard stays at `/downloads` (auth-gated, in the
 * app shell); GuestLibrary links signed-in visitors there rather than walling
 * signed-out ones out here. The header/completion-card entry points prefetch
 * this route so the first tap is instant.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Your downloads",
  description: "Track your saved downloads, storage usage and history — no account needed.",
  // Per-device, private to the visitor; nothing to index.
  robots: { index: false, follow: false },
};

export default function LibraryPage() {
  return (
    <div className="bg-background text-foreground">
      <SiteHeader />
      <main className="pb-24 pt-28 sm:pt-32">
        <GuestLibrary />
      </main>
      <SiteFooter />
    </div>
  );
}
