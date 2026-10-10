import Link from "next/link";
import type { ReactNode } from "react";

import { StableAvatar } from "@/components/ui/stable-avatar";
import { cn } from "@/lib/utils";

/**
 * The Friends surfaces' one design language (owner, 2026-10-10: "glassy,
 * professional, lightweight social platform").
 *
 *   · GLASS — a frosted surface (translucent fill + backdrop blur + hairline
 *     ring + one soft shadow) over the page's quiet ambient wash. Pure CSS: no
 *     library, no image, nothing to download.
 *   · GROUPED LISTS — people sit as rows inside ONE glass card with hairline
 *     dividers (an inset grouped list), not as a stack of separately bordered
 *     boxes. Less chrome per person is what makes it read light.
 *   · ONE avatar — the cached, CDN-sized StableAvatar every list uses, so a face
 *     seen anywhere is instant here.
 *   · Quiet controls — 44 px targets, icons with labels for screen readers, one
 *     solid primary action per row at most.
 */
export const GLASS =
  "bg-white/75 backdrop-blur-xl ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-14px_rgba(15,23,42,0.18)] dark:bg-white/[0.05] dark:ring-white/10 dark:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6)]";

/** The soft colour behind the glass — two blurred tints at the top of the page; static, no animation. */
export function AmbientWash() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-72 overflow-hidden">
      <div className="absolute -left-16 top-0 h-56 w-56 rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-500/15" />
      <div className="absolute -right-10 top-10 h-48 w-48 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-500/15" />
    </div>
  );
}

export function GlassGroup({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn("divide-y divide-black/[0.06] overflow-hidden rounded-[22px] dark:divide-white/[0.07]", GLASS, className)}>
      {children}
    </ul>
  );
}

export function SectionHeader({ title, count, action, id }: { title: string; count?: number; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h2 id={id} className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
        {count ? <span className="rounded-full bg-primary/10 px-1.5 py-px text-[11px] font-bold tabular-nums text-primary">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}

export function PersonAvatar({
  user,
  size = 44,
  online = false,
}: {
  user: { displayName: string; avatarUrl: string | null };
  size?: 36 | 44 | 52;
  online?: boolean;
}) {
  const box = size === 36 ? "h-9 w-9 text-sm" : size === 52 ? "h-[52px] w-[52px] text-base" : "h-11 w-11 text-[15px]";
  return (
    <span className="relative inline-flex shrink-0">
      {user.avatarUrl ? (
        <StableAvatar src={user.avatarUrl} width={size} height={size} className={cn(box, "rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10")} />
      ) : (
        <span aria-hidden className={cn(box, "flex items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-300 font-semibold text-slate-600 dark:from-slate-700 dark:to-slate-800 dark:text-slate-200")}>
          {user.displayName.charAt(0).toUpperCase()}
        </span>
      )}
      {online ? <span aria-label="Online" className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" /> : null}
    </span>
  );
}

const ICON_BTN =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground/80 transition hover:bg-black/[0.04] active:scale-95 motion-reduce:active:scale-100 disabled:opacity-50 dark:hover:bg-white/[0.06]";

export function GlassIconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} className={cn(ICON_BTN, GLASS, "shadow-none")}>
      {children}
    </Link>
  );
}

export const iconButton = ICON_BTN;
export const primaryPill =
  "inline-flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground shadow-[0_6px_16px_-8px_hsl(var(--primary)/0.7)] transition active:scale-[0.98] disabled:opacity-60 motion-reduce:active:scale-100";
export const quietPill =
  "inline-flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-full bg-black/[0.04] px-3.5 text-[13.5px] font-semibold text-foreground/80 transition hover:bg-black/[0.07] active:scale-[0.98] disabled:opacity-60 motion-reduce:active:scale-100 dark:bg-white/[0.07] dark:hover:bg-white/[0.1]";
