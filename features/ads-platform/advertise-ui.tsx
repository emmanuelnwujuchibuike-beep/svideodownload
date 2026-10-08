import type { LucideIcon } from "lucide-react";
import { Check, Clapperboard, LayoutTemplate, Maximize2, PanelTop, RectangleHorizontal, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The advertiser application's own small pieces, on the Frenz AI language
 * (white ground, the 1.75 rem panels, the brand gradient used ONCE per view)
 * but without the AI wash and crumb — this is a checkout, not a generator.
 * No hooks: safe to render from server or client.
 */

/** Presentation only: an icon per format. An admin-added format falls back to Sparkles. */
const FORMAT_ICONS: Record<string, LucideIcon> = {
  TOP_BANNER: PanelTop,
  CONTENT_BANNER: RectangleHorizontal,
  DOWNLOAD_RESULT_BANNER: LayoutTemplate,
  INTERSTITIAL: Maximize2,
  DOWNLOAD_COMPLETED_INTERSTITIAL: Maximize2,
  REWARD_VIDEO: Clapperboard,
};
export const formatIcon = (code: string): LucideIcon => FORMAT_ICONS[code] ?? Sparkles;

export function IconChip({ icon: Icon, active }: { icon: LucideIcon; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset transition-colors",
        active ? "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white ring-transparent" : "bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-indigo-100",
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
        selected ? "ring-2 ring-indigo-500 shadow-[0_12px_30px_-20px_rgba(79,70,229,0.6)]" : "ring-black/[0.08] hover:ring-indigo-200",
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
            selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white",
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
        tone === "slate" && "bg-slate-100 text-slate-600",
        tone === "indigo" && "bg-indigo-50 text-indigo-700",
        tone === "emerald" && "bg-emerald-50 text-emerald-700",
        tone === "amber" && "bg-amber-50 text-amber-800",
        tone === "rose" && "bg-rose-50 text-rose-700",
      )}
    >
      {children}
    </span>
  );
}

/** "Step 3 of 8 · Duration" with a segmented bar. */
export function Stepper({ index, total, label }: { index: number; total: number; label: string }) {
  return (
    <div aria-label={`Step ${index + 1} of ${total}: ${label}`}>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= index ? "bg-gradient-to-r from-blue-500 to-violet-500" : "bg-slate-200")} />
        ))}
      </div>
      <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Step {index + 1} of {total} · {label}
      </p>
    </div>
  );
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
        tone === "indigo" && "bg-indigo-50/70 text-indigo-900",
        tone === "amber" && "bg-amber-50 text-amber-900",
        tone === "rose" && "bg-rose-50 text-rose-800",
        tone === "emerald" && "bg-emerald-50 text-emerald-900",
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
      <span className={cn("min-w-0", !strong && "text-[13.5px]")}>{label}</span>
      <span className={cn("shrink-0 text-right tabular-nums", !strong && "text-[13.5px] font-semibold")}>{value}</span>
    </div>
  );
}
