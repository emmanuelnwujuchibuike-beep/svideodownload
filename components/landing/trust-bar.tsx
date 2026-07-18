import { BRAND_ICONS } from "@/lib/platform-icons";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";

/**
 * The platform trust bar, per `public/main landing page.jpg` — a single row of
 * supported-platform marks beneath the hero.
 *
 * ── The caption ───────────────────────────────────────────────────────────────
 *
 * The mockup captions this "Trusted by creators and millions of users worldwide".
 * That is an unsourceable scale claim of exactly the kind the Reality Ledger fails
 * the build on — and it would fail it, since `millions` is now caught as a worded
 * magnitude. The caption instead states what the row actually shows, which is also
 * the more useful sentence: these are the platforms it works with.
 *
 * Marks are DERIVED from the platform registry rather than hand-listed, so the row
 * cannot drift from what the downloader actually supports — the same reason the
 * "11 Platforms" heading is derived rather than typed.
 */
export function TrustBar() {
  return (
    <section className="border-y border-border bg-muted/30 py-6 dark:border-white/10 dark:bg-white/[0.02]">
      <div className="container max-w-6xl">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Works with the platforms you already use
        </p>

        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
          {SHOWCASE_PLATFORMS.map((platform) => {
            const Icon = BRAND_ICONS[platform.id];
            return (
              <li key={platform.id} className="flex items-center gap-2 text-foreground/70">
                {Icon ? <Icon className="h-4 w-4" /> : null}
                <span className="text-sm font-medium">{platform.name}</span>
              </li>
            );
          })}
          <li className="text-sm font-medium text-muted-foreground">&amp; more</li>
        </ul>
      </div>
    </section>
  );
}
