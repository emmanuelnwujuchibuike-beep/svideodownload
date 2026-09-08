import { FrenzAICrumb } from "@/features/ai/frenz-ai-chrome";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE HERO, ON EVERY FRENZ AI SCREEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "the hero i said to be removed in ai finalise page and use
 * the new upgraded hero in all ai pages."
 *
 * ── 🔴 WHY THERE WERE TWO ───────────────────────────────────────────────────
 *
 * The redesign gave the input, progress and result screens each their own
 * opening — breadcrumb, a headline with "videos" in brand gradient, a subhead.
 * `FrenzAIHeader`, the ORIGINAL, kept rendering above every OTHER state: the
 * link field, the file preview, the ready panel, and the error screens.
 *
 * So a member who hit an error saw the old header AND the new one stacked, with
 * two different typographic treatments of the same product, one above the
 * other. That is exactly what the owner has been pointing at, twice.
 *
 * This is the new treatment, extracted so every screen uses the same object
 * rather than three copies that drift. `FrenzAIHeader` is no longer rendered
 * anywhere in the workspace.
 *
 * A server component. It holds no state and takes no handlers.
 */
export function FrenzAIPageHero({
  /** The word rendered in brand gradient inside the headline. */
  highlight = "videos",
  title = "Clean your",
  tail = "with AI.",
  subtitle = "Remove unwanted captions, subtitles and text overlays while keeping your video looking natural.",
  action,
  className,
}: {
  highlight?: string;
  title?: string;
  tail?: string;
  subtitle?: string | null;
  /** Optional trailing control, e.g. "How it works". */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("px-1", className)}>
      <FrenzAICrumb tool="AI Clean" />

      <h1 className="mt-3.5 text-[1.95rem] font-bold leading-[1.08] tracking-[-0.04em] sm:text-[2.3rem]">
        {title} <span className="text-gradient">{highlight}</span>
        <br />
        {tail}
      </h1>

      {subtitle ? (
        <p className="mt-2.5 max-w-sm text-[14.5px] leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      ) : null}

      {action ? <div className="mt-3.5">{action}</div> : null}
    </header>
  );
}
