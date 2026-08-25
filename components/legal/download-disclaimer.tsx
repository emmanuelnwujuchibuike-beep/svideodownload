import { cn } from "@/lib/utils";

/**
 * The trademark / non-affiliation disclaimer shown below every download box, on
 * every page that has one (owner-supplied copy, verbatim). Placed inside the
 * `Downloader` by default; the landing renders it below the purple card instead
 * (where the muted colour reads), so `Downloader` is told to skip its own there.
 */
export function DownloadDisclaimer({
  className,
  /**
   * 🔴 An explicit prop rather than a `text-left` passed through `className`.
   *
   * Tailwind emits `text-left` BEFORE `text-center`, and CSS resolves ties by
   * source order in the stylesheet, not by order in the class attribute — so a
   * `text-left` override would lose silently and look like it had been applied.
   * That class of trap has cost this codebase real time more than once. Only
   * one alignment utility is ever on the element now, so there is nothing to
   * resolve.
   */
  align = "center",
  /**
   * `card` is the treatment in `public/newnativeapplandingpage.jpg` — a tinted
   * panel with an info mark beside the text. `plain` is the original bare
   * paragraph, kept for every other surface that already renders one.
   */
  variant = "plain",
}: {
  className?: string;
  align?: "center" | "left";
  variant?: "plain" | "card";
}) {
  const COPY = (
    <>
      Frenzsave is an independent service and is not affiliated with, endorsed by, or
      sponsored by TikTok, Instagram, LinkedIn, Snapchat, Facebook, or X. All
      trademarks and logos are the property of their respective owners.
    </>
  );

  /*
    ── 🔴 The card treatment (owner, 2026-08-11: "100% exact") ───────────────
    The reference gives this paragraph a surface of its own and an info mark to
    its left, which is what turns a wall of grey legal text into a recognisable
    "note" block — the same convention a native app uses for a footnote.

    The mark is a plain bordered circle drawn in CSS, NOT an icon import: this
    is the last element on the landing page and pulling a lucide glyph in for
    one decorative ring would add a component to a page held at a 275 kB
    ceiling. It is `aria-hidden` because the paragraph already says everything —
    an "information" announcement before it would be noise.

    No blur and no shadow on this panel. Every landing surface that can be flat
    is flat: a backdrop-filter here is a full-screen GPU pass on a device that is
    already compositing the gradient CTA above it, and this page has to stay cool
    on a cheap phone.
  */
  if (variant === "card") {
    return (
      <div
        className={cn(
          "mt-6 flex items-start gap-3 rounded-2xl bg-slate-500/[0.06] p-4 dark:bg-white/[0.04]",
          className,
        )}
      >
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-400/50 text-[11px] font-bold italic text-slate-500 dark:border-white/25 dark:text-white/50"
        >
          i
        </span>
        <p className="text-left text-[11px] leading-relaxed text-muted-foreground">{COPY}</p>
      </div>
    );
  }

  return (
    <p
      className={cn(
        "mx-auto mt-6 max-w-2xl px-4 text-[11px] leading-relaxed text-muted-foreground",
        align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      {COPY}
    </p>
  );
}
