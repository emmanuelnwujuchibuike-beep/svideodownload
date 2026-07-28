import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared building blocks for every Settings page (design: public/profile settings.jpg):
 * a grouped card of tinted icon-tile rows. Use `SettingsGroup` for the section
 * (uppercase label + description + card) and `SettingsRow` for each item — a
 * coloured icon tile, title (+ optional tag), description, and a right slot for a
 * value / action / chevron. Keeps all settings visually consistent.
 */

export const SETTINGS_TINTS: Record<string, string> = {
  violet: "bg-violet-500/12 text-violet-500 ring-violet-500/25 dark:text-violet-400",
  blue: "bg-blue-500/12 text-blue-500 ring-blue-500/25 dark:text-blue-400",
  emerald: "bg-emerald-500/12 text-emerald-500 ring-emerald-500/25 dark:text-emerald-400",
  amber: "bg-amber-500/12 text-amber-500 ring-amber-500/25 dark:text-amber-400",
  purple: "bg-fuchsia-500/12 text-fuchsia-500 ring-fuchsia-500/25 dark:text-fuchsia-400",
  rose: "bg-rose-500/12 text-rose-500 ring-rose-500/25 dark:text-rose-400",
  cyan: "bg-cyan-500/12 text-cyan-500 ring-cyan-500/25 dark:text-cyan-400",
  slate: "bg-slate-500/12 text-slate-500 ring-slate-500/25 dark:text-slate-300",
};

export function SettingsGroup({
  label,
  description,
  children,
  className,
}: {
  label?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-5", className)}>
      {label ? <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p> : null}
      {description ? <p className="mt-0.5 px-1.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className={cn("overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm", (label || description) && "mt-2")}>
        <div className="divide-y divide-border/60">{children}</div>
      </div>
    </section>
  );
}

export function SettingsRow({
  icon: Icon,
  tint = "slate",
  title,
  tag,
  description,
  right,
  href,
  onClick,
  chevron,
  ["aria-expanded"]: ariaExpanded,
}: {
  icon: LucideIcon;
  tint?: keyof typeof SETTINGS_TINTS | string;
  title: string;
  tag?: string;
  description?: ReactNode;
  right?: ReactNode;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  "aria-expanded"?: boolean;
}) {
  const inner = (
    <>
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", SETTINGS_TINTS[tint] ?? SETTINGS_TINTS.slate)}>
        <Icon className="h-[19px] w-[19px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{title}</span>
          {tag ? <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{tag}</span> : null}
        </span>
        {description ? <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span> : null}
      </span>
      {right ? <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">{right}</span> : null}
      {chevron ? <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const cls = "flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-secondary/40";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-expanded={ariaExpanded} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className="flex items-center gap-3 px-3.5 py-3">{inner}</div>;
}
