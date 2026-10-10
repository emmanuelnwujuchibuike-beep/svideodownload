import type { LucideIcon } from "lucide-react";
import { Check, Clapperboard, LayoutGrid, LayoutTemplate, Maximize2, PanelTop, RectangleHorizontal, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { AiStepRail } from "@/features/ai/design/ai-step-rail";
import type { ApplicationStep } from "@/lib/ads-platform/application";
import { cn } from "@/lib/utils";

/**
 * The advertiser application's own small pieces, on the Frenz AI language
 * (white ground, the 1.75 rem panels, the brand gradient used ONCE per view)
 * but without the AI wash and crumb — this is a checkout, not a generator.
 * No hooks: safe to render from server or client.
 *
 * Theme: every surface here reads the app's tokens (`bg-card`, `bg-secondary`,
 * `text-muted-foreground`) or carries its `dark:` pair, so the flow follows the
 * member's light/dark choice like the rest of Frenzsave (owner brief §73).
 * The tinted notices keep their hue in dark mode at a low alpha — the same
 * treatment `.dark .ai-strip-cta` uses.
 */

/** Presentation only: an icon per format. An admin-added format falls back to Sparkles. */
const FORMAT_ICONS: Record<string, LucideIcon> = {
  TOP_BANNER: PanelTop,
  CONTENT_BANNER: RectangleHorizontal,
  DOWNLOAD_RESULT_BANNER: LayoutTemplate,
  INTERSTITIAL: Maximize2,
  DOWNLOAD_COMPLETED_INTERSTITIAL: Maximize2,
  REWARD_VIDEO: Clapperboard,
  // 0211: every slot at once
  ALL_SLOTS: LayoutGrid,
};
export const formatIcon = (code: string): LucideIcon => FORMAT_ICONS[code] ?? Sparkles;

export function IconChip({ icon: Icon, active }: { icon: LucideIcon; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset transition-colors",
        active
          ? "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white ring-transparent"
          : "bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-indigo-100 dark:from-indigo-500/15 dark:to-sky-500/10 dark:text-indigo-300 dark:ring-indigo-400/20",
      )}
      aria-hidden
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** A selectable card. Rendered as a real <button> with aria-pressed (or role=radio by the caller). */
export function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  badge,
  children,
  trailing,
  multi,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: LucideIcon;
  title: string;
  badge?: ReactNode;
  children?: ReactNode;
  trailing?: ReactNode;
  multi?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group relative flex w-full items-start gap-3.5 rounded-[1.4rem] bg-card p-4 text-left ring-1 ring-inset transition-[box-shadow,transform] duration-150 active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        selected
          ? "ring-2 ring-indigo-500 shadow-[0_12px_30px_-20px_rgba(79,70,229,0.6)]"
          : "ring-black/[0.08] hover:ring-indigo-200 dark:ring-white/10 dark:hover:ring-indigo-400/40",
      )}
    >
      {icon ? <IconChip icon={icon} active={selected} /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">{title}</span>
          {badge}
        </span>
        {children ? <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{children}</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-2">
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center border transition-colors",
            multi ? "rounded-md" : "rounded-full",
            selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-card dark:border-white/25",
          )}
          aria-hidden
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
        {trailing}
      </span>
    </button>
  );
}

export function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "indigo" | "emerald" | "amber" | "rose" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold leading-5",
        tone === "slate" && "bg-secondary text-muted-foreground",
        tone === "indigo" && "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200",
        tone === "emerald" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
        tone === "amber" && "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
        tone === "rose" && "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The advertiser's journey in five phases — Format · Placement · Creative ·
 * Review · Payment (owner brief §62: "a compact step indicator") — on the
 * shared Frenz AI step rail, so it is the same rail Character Replace shows.
 * The application's eight screens fold into the first four; Payment is the
 * return page. A finished phase is tappable when `onGo` is given.
 */
export const AD_FLOW_PHASES = [
  { id: "format", label: "Format" },
  { id: "placement", label: "Placement" },
  { id: "creative", label: "Creative" },
  { id: "review", label: "Review" },
  { id: "payment", label: "Payment" },
] as const;
export type AdFlowPhase = (typeof AD_FLOW_PHASES)[number]["id"];

const PHASE_OF: Record<ApplicationStep, AdFlowPhase> = {
  format: "format",
  placement: "placement",
  duration: "placement",
  creative: "creative",
  details: "creative",
  preview: "creative",
  rules: "review",
  review: "review",
};
export const phaseOf = (step: ApplicationStep): AdFlowPhase => PHASE_OF[step];

/** The first screen of a phase — where "back to Placement" lands. */
export const FIRST_STEP_OF: Record<Exclude<AdFlowPhase, "payment">, ApplicationStep> = {
  format: "format",
  placement: "placement",
  creative: "creative",
  review: "rules",
};

export function AdFlowRail({ phase, onGo, className }: { phase: AdFlowPhase; onGo?: (phase: AdFlowPhase) => void; className?: string }) {
  const i = AD_FLOW_PHASES.findIndex((p) => p.id === phase);
  return <AiStepRail steps={AD_FLOW_PHASES} currentIndex={i} onGo={onGo} className={className} label="Campaign steps" />;
}

export function StepTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <header className="mt-3">
      <h2 className="font-brand text-[1.55rem] font-bold leading-[1.15] tracking-[-0.03em]">{title}</h2>
      {sub ? <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{sub}</p> : null}
    </header>
  );
}

export function Notice({ icon: Icon, children, tone = "indigo" }: { icon: LucideIcon; children: ReactNode; tone?: "indigo" | "amber" | "rose" | "emerald" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px] leading-snug",
        tone === "indigo" && "bg-indigo-50/70 text-indigo-900 dark:bg-indigo-500/12 dark:text-indigo-100",
        tone === "amber" && "bg-amber-50 text-amber-900 dark:bg-amber-500/12 dark:text-amber-100",
        tone === "rose" && "bg-rose-50 text-rose-800 dark:bg-rose-500/12 dark:text-rose-200",
        tone === "emerald" && "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/12 dark:text-emerald-100",
      )}
      role={tone === "rose" ? "alert" : undefined}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A label/value row for summaries and the price breakdown. */
export function Row({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", strong && "pt-3 text-[16px] font-bold", muted && "text-muted-foreground")}>
      <span className={cn("max-w-[60%] shrink-0", !strong && "text-[13.5px]")}>{label}</span>
      <span className={cn("min-w-0 flex-1 text-right tabular-nums [overflow-wrap:anywhere]", !strong && "text-[13.5px] font-semibold")}>{value}</span>
    </div>
  );
}

/** "30 days + 5 bonus days" — the campaign's length as the advertiser bought it. */
export function runtimeLabel(days: number | null | undefined, extraDays: number | null | undefined): string | null {
  if (!days) return null;
  const extra = extraDays ?? 0;
  return `${days} ${days === 1 ? "day" : "days"}${extra > 0 ? ` + ${extra} bonus ${extra === 1 ? "day" : "days"}` : ""}`;
}

/**
 * The campaign summary card (owner brief §54): what was bought, in the order a
 * person reads it — placement, format, runtime, then the price on its own
 * line. Used by the review step BEFORE payment and by the return page after,
 * so the advertiser sees the same card on both sides of the checkout.
 */
export function CampaignSummaryCard({
  title = "Campaign summary",
  name,
  placements,
  format,
  runtime,
  promotion,
  total,
  was,
  totalLabel = "Total",
  totalNote,
  details,
  footer,
  className,
}: {
  title?: string;
  name?: string | null;
  placements: string[];
  format: string | null;
  runtime: string | null;
  promotion?: string | null;
  total?: string | null;
  /** the undiscounted price, struck through */
  was?: string | null;
  totalLabel?: string;
  /** a smaller line under the total, e.g. the amount in the checkout's currency */
  totalNote?: string | null;
  /** quiet rows read BEFORE the price (creative, destination) — the price stays last */
  details?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("rounded-[1.75rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07] shadow-[0_10px_30px_-24px_rgba(30,40,90,0.4)] dark:ring-white/10 sm:p-5", className)}
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      {name ? <p className="mt-1 truncate text-[13.5px] text-muted-foreground">{name}</p> : null}
      <p className="mt-2.5 font-brand text-[1.3rem] font-bold leading-tight tracking-[-0.025em]">{placements.join(" · ") || "—"}</p>
      {format ? <p className="mt-0.5 text-[14.5px] font-semibold text-foreground/80">{format}</p> : null}
      {runtime ? <p className="mt-3 text-[14px] font-semibold tabular-nums">{runtime}</p> : null}
      {promotion ? <p className="mt-0.5 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">{promotion}</p> : null}
      {details ? <div className="mt-3 border-t border-border/70 pt-2">{details}</div> : null}
      {total ? (
        <div className="mt-3 flex items-end justify-between gap-3 border-t border-border/70 pt-3">
          <span className="text-[13.5px] font-semibold text-muted-foreground">{totalLabel}</span>
          <span className="text-right">
            {was ? <s className="mr-2 text-[13px] font-medium text-muted-foreground">{was}</s> : null}
            <span className="font-brand text-[1.6rem] font-bold leading-none tracking-[-0.03em] tabular-nums">{total}</span>
            {totalNote ? <span className="mt-1 block text-[12.5px] font-semibold tabular-nums text-muted-foreground">{totalNote}</span> : null}
          </span>
        </div>
      ) : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </section>
  );
}
