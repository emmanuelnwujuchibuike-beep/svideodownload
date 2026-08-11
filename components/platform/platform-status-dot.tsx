import { PLATFORM_STATUS_META, type PlatformStatus } from "@/lib/platform-status";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE STATUS LIGHT ON A PLATFORM LOGO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-11: "green, yellow and red should show, not only red … when
 * they tap they should see the status description."
 *
 * ── 🔴 GREEN IS SHOWN. I had it silent, and that was overruled ────────────
 *
 * The first version rendered nothing for `operational`, reasoning that eight
 * green dots become wallpaper and drown the one amber dot that matters. That is
 * a real argument and it is not the one that wins here: a light that only ever
 * appears when something is broken cannot be TRUSTED, because its absence is
 * indistinguishable from the feature being missing. A visitor who never sees a
 * dot learns nothing; one who sees green learns the platform was checked and is
 * working. Confidence is the product this badge sells, and it needs the healthy
 * state to say so out loud.
 *
 * ── Why it is a dot, not a tick mark ──────────────────────────────────────
 *
 * A tick MEANS "yes" — a red tick is a contradiction and an amber one is
 * unreadable. This is a status LIGHT, the shape every status page and OS
 * presence indicator already uses, so nobody has to learn it. The white ring
 * keeps it legible on a tile of any colour, including the black (TikTok) and
 * yellow (Snapchat) ones where a bare dot disappears.
 *
 * ── 🔴 Tap-to-explain, with ZERO JavaScript ───────────────────────────────
 *
 * `title` is a desktop-hover affordance; on a phone it never appears, so the
 * description was unreachable for most visitors. The dot is a real `<button>`
 * now, and the description is revealed by `:focus-within` / `:hover` in CSS —
 * a tap focuses it, a tap elsewhere blurs it.
 *
 * That matters because this renders on the LANDING PAGE, which sits at its
 * 275 kB budget and must stay cool on a cheap phone. A React popover would mean
 * a client component, hydration and a state update per tap on the one page that
 * cannot afford any of it. Focus is a browser primitive; it costs nothing, works
 * before hydration, and works with a keyboard for free.
 *
 * `type="button"` is load-bearing — inside the download form's markup a default
 * `<button>` submits it.
 */
export function PlatformStatusDot({
  status,
  platformName,
  /**
   * Kept as an escape hatch for surfaces that genuinely only want exceptions.
   * Defaults ON now — see the note above on why the healthy state must speak.
   */
  showHealthy = true,
  size = "md",
  className,
}: {
  status: PlatformStatus;
  platformName: string;
  showHealthy?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  if (status === "operational" && !showHealthy) return null;
  const meta = PLATFORM_STATUS_META[status];
  const px = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <span className={cn("absolute -right-1 -top-1 z-10 leading-none", className)}>
      <button
        type="button"
        aria-label={`${platformName}: ${meta.label}. ${meta.description}`}
        className={cn(
          // The hit target is the padding, not the dot: a 10px tap target fails
          // WCAG 2.5.8 outright and is genuinely hard to hit one-handed.
          "peer block cursor-help rounded-full p-1.5 outline-none",
        )}
      >
        <span
          className={cn(
            "block rounded-full ring-2 ring-white shadow-sm dark:ring-neutral-900",
            px,
            meta.dot,
          )}
        />
      </button>

      {/*
        ── 🔴 A VIEWPORT SHEET, NOT AN ANCHORED TOOLTIP ────────────────────────

        Owner, 2026-08-11: "the platform status description modal display isn't
        professionally responsive when clicked — the ones at the edge or bottom."

        It was `absolute right-0 top-7 w-44`, i.e. a 176px box hanging down and to
        the LEFT of its dot. That has two failure modes and the owner hit both:

        • THE EDGE. The first tiles in the row sit ~40px from the screen edge, so
          a box extending 176px leftward from them lands at negative x and is cut
          off by the viewport.
        • THE CARD. On the download page this strip renders inside the purple
          panel, which is `overflow-hidden` for its gradient and radius. An
          absolutely-positioned child of an `overflow-hidden` ancestor is clipped
          to it, full stop — so the box was sliced off by the card's rounded
          corner regardless of where it was anchored.

        There is no anchoring value that fixes both, because the second one is not
        about position at all. `position: fixed` is: it takes the sheet out of
        every ancestor's overflow AND out of the row's geometry, so it is placed
        against the viewport and can never be clipped or pushed off-screen by
        whichever tile happens to be tapped. Every dot now shows the same sheet in
        the same place — which is also what a native app does with a tap-to-explain,
        and is far easier to read than eight boxes appearing in eight positions.

        🔴 Verified in the browser at four widths on both surfaces rather than
        reasoned about: `position: fixed` resolves against the nearest ancestor
        with a transform/filter/`will-change` instead of the viewport, and this
        codebase HAS such ancestors (`.frenz-reveal` animates `translateY`). The
        test asserts the sheet's measured rect against the viewport rect.

        `pointer-events-none` so it can never swallow the tap that dismisses it.
      */}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] mx-auto w-auto max-w-sm translate-y-1.5 rounded-2xl bg-slate-900 px-3.5 py-3 text-left text-xs leading-snug text-white opacity-0 shadow-2xl transition duration-150",
          "peer-hover:translate-y-0 peer-hover:opacity-100 peer-focus:translate-y-0 peer-focus:opacity-100",
          "motion-reduce:transition-none dark:bg-slate-800",
        )}
      >
        <span className="flex items-center gap-2 font-bold">
          {/* The dot repeats inside the sheet so the colour just tapped is
              restated beside its meaning — otherwise the sheet explains a status
              without ever showing which one it belongs to. */}
          <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
          {platformName} · {meta.short}
        </span>
        <span className="mt-1 block text-white/75">{meta.description}</span>
      </span>
    </span>
  );
}

/**
 * The same state as a labelled chip, for places with room for words — the admin
 * panel and the status list. Colour is never the only channel here either.
 */
export function PlatformStatusChip({ status, className }: { status: PlatformStatus; className?: string }) {
  const meta = PLATFORM_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        meta.text,
        meta.ring,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden />
      {meta.short}
    </span>
  );
}
