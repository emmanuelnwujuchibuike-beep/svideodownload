import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";

import { AICleanProBadge } from "@/features/ai/ai-clean-pro-badge";
import type { FrenzAiStudioTool } from "@/lib/ai/studio-tools";
import { cn } from "@/lib/utils";

/**
 * One tool on the Frenz AI hub.
 *
 * ── An unbuilt tool is not a button ───────────────────────────────────────────
 * A `soon` tool renders as a plain, unfocusable panel: no link, no hover lift,
 * no cursor change, and the icon tile drops to the muted surface instead of the
 * brand gradient. Every one of those is deliberate — a card that LOOKS pressable
 * and does nothing is the affordance this codebase has had to delete three
 * separate times. The "Coming soon" pill is the label, and the flat treatment is
 * what makes it believable before anyone reads it.
 *
 * A server component. The whole card is one `<Link>` for the tools that have a
 * page, so it works before hydration and a tap on a cold page is an ordinary
 * navigation.
 */
export function FrenzAIToolCard({ tool }: { tool: FrenzAiStudioTool }) {
  const { icon: Icon, href, status, name, blurb, pro } = tool;
  const open = href !== null;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition",
            open ? "bg-brand-tile text-white shadow-sm" : "bg-secondary text-muted-foreground",
          )}
        >
          <Icon className="h-[22px] w-[22px]" aria-hidden />
        </span>

        <div className="flex items-center gap-1.5">
          {pro ? <AICleanProBadge /> : null}
          {status === "soon" ? (
            <span className="inline-flex select-none items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Lock className="h-2.5 w-2.5" aria-hidden />
              Coming soon
            </span>
          ) : null}
        </div>
      </div>

      <h2 className={cn("mt-4 text-base font-bold tracking-[-0.01em]", !open && "text-muted-foreground")}>{name}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{blurb}</p>

      {/* `self-start` matters: the card is a column flex container, so without it
          the pill stretches to the full width on every breakpoint and `w-auto`
          alone does nothing. Full-width on a phone is the right target size;
          hugging its label on a desktop is the right weight. */}
      {open ? (
        <span className="btn-lux btn-lux-primary mt-5 w-full sm:w-auto sm:self-start" aria-hidden>
          Open {name}
          <ArrowRight className="h-4 w-4" />
        </span>
      ) : null}
    </>
  );

  const shell =
    "group relative flex h-full flex-col rounded-3xl border p-5 transition sm:p-6";

  if (!open) {
    return (
      <div className={cn(shell, "border-dashed border-border/70 bg-card/40")}>{body}</div>
    );
  }

  return (
    <Link
      href={href}
      prefetch
      // The card is the control, so it carries the accessible name: the visible
      // "Open …" pill inside is aria-hidden, which is what stops a screen reader
      // announcing the tool's name twice on one link.
      aria-label={`Open ${name}`}
      className={cn(
        shell,
        "border-border/70 bg-card shadow-card outline-none",
        "hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.995]",
      )}
    >
      {body}
    </Link>
  );
}
