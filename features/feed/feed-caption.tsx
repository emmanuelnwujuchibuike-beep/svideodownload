"use client";

import { ChevronUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { RichText } from "@/components/social/rich-text";
import { cn } from "@/lib/utils";

/**
 * A feed caption, clamped to seven lines with an expand/collapse pair.
 *
 * Owner, 2026-08-23: "Captions in feed should have a limit of 7 lines, any
 * captions and paragraph more than 7 lines should show see more to expand, and
 * a small close button below to reshrink the caption back to 7 lines."
 *
 * ── Why the controls are SIBLINGS of the link, not inside it ───────────────
 * The caption in `feed-post-card.tsx` is wrapped in a real `<Link>` to the
 * post's canonical URL — deliberately, so crawlers can reach every post from
 * the feed (the 2026-08-18 SEO audit found the card had no crawlable link at
 * all). A `<button>` nested inside an `<a>` is invalid HTML and browsers
 * recover from it inconsistently, so "See more" would sometimes navigate
 * instead of expanding. The clamped text keeps its link; the controls sit
 * beneath it.
 *
 * ── Why overflow is MEASURED rather than counted ───────────────────────────
 * "More than 7 lines" is a question about rendered layout, not about the
 * string: it depends on the viewport width, the font, and where each word
 * wraps. Counting `\n` would miss a single long paragraph that wraps to
 * twelve lines — the most common case by far — and would also show a "See
 * more" that expands to nothing on a wide screen. Comparing `scrollHeight`
 * against `clientHeight` while clamped asks the browser the question directly.
 *
 * The measurement re-runs on resize (a phone rotating changes the answer) and
 * whenever the text changes.
 */
export function FeedCaption({
  text,
  children,
  className,
}: {
  text: string;
  /**
   * The clamped text, already wrapped in whatever link/handler the surface
   * needs. Rendered inside the clamping box. When omitted this falls back to
   * plain `RichText`, which is what a non-linked surface wants.
   */
  children?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Only meaningful while the clamp is applied — an expanded box always
    // reports scrollHeight === clientHeight, which would clear the flag and
    // remove the "Show less" control the reader needs to collapse again.
    if (expanded) return;
    // 1px of slack: sub-pixel line-height rounding makes an exactly-7-line
    // caption report a scrollHeight a fraction taller than its clientHeight on
    // some zoom levels, which would offer a "See more" that reveals nothing.
    setOverflows(el.scrollHeight - el.clientHeight > 1);
  }, [expanded]);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    // Observing the element catches column-width changes the window's own
    // resize event does not — a sidebar opening, for instance.
    const obs = new ResizeObserver(measure);
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [measure, text]);

  const collapse = () => {
    setExpanded(false);
    // Re-measure on the next frame, once the clamp is back on: `measure`
    // bails while `expanded` is true, so without this the flag would keep
    // whatever value it had before expanding.
    requestAnimationFrame(measure);
  };

  return (
    <div className={className}>
      <div
        ref={ref}
        className={cn(
          "text-[15px] leading-relaxed",
          // `line-clamp-[7]` rather than a fixed max-height: it clamps by LINE
          // regardless of font size or the reader's own text-size setting,
          // where a pixel height would show six lines to someone with larger
          // text and eight to someone with smaller.
          //
          // 🔴 The 7 is written as a LITERAL on purpose. Tailwind extracts
          // class names by scanning source text, so `line-clamp-[${N}]` would
          // compile to nothing at all and the caption would silently stop
          // clamping. It must stay in step with `CAPTION_CLAMP_LINES` in
          // lib/social/caption.ts, which is the documented value.
          !expanded && "line-clamp-[7]",
        )}
      >
        {children ?? <RichText text={text} />}
      </div>

      {/* "See more" only when there is genuinely more — never a control that
          does nothing when tapped. */}
      {overflows && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="mt-0.5 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          See more
        </button>
      ) : null}

      {/*
        The "small close button below" the owner asked for. It sits AFTER the
        expanded text rather than beside "See more", because after reading a
        250-word caption the reader's eye is at the bottom — putting the
        collapse control back up at the top would mean scrolling up to find it.
      */}
      {expanded ? (
        <button
          type="button"
          onClick={collapse}
          aria-expanded
          aria-label="Collapse caption"
          className="mt-1 inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <ChevronUp className="h-3 w-3" />
          Show less
        </button>
      ) : null}
    </div>
  );
}
