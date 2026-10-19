import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** One Settings row (design/Settings.dc.html, 2026-10-18): an icon square, title, description, the current value. */
export type SettingsRowSpec = { href: string; Icon: LucideIcon; title: string; sub: string; tint: string; value?: string };

/** The design's solid icon squares: one colour per tint, a white glyph. */
const SOLID: Record<string, string> = {
  violet: "bg-frenz-violet",
  purple: "bg-frenz-violet",
  blue: "bg-frenz-blue",
  cyan: "bg-frenz-blue",
  rose: "bg-frenz-magenta",
  emerald: "bg-emerald-600",
  amber: "bg-amber-500",
  slate: "bg-frenz-ink dark:bg-white/20",
};

export function SettingsList({ heading, rows, children }: { heading: string; rows: SettingsRowSpec[]; children?: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="m-0 px-1 pb-2 text-[13px] font-bold text-frenz-muted">{heading}</h2>
      <ul className="overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
        {rows.map((row, i) => (
          <li key={row.href} className={cn(i > 0 && "border-t border-frenz-line")}>
            <SettingsLink row={row} />
          </li>
        ))}
        {children}
      </ul>
    </section>
  );
}

/** Each row is its own page, prefetched on open so it opens with no loading state. */
export function SettingsLink({ row }: { row: SettingsRowSpec }) {
  return (
    <Link href={row.href} prefetch className="flex min-h-[60px] items-center gap-3 px-3.5 py-2 transition active:bg-frenz-fill">
      <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white", SOLID[row.tint] ?? SOLID.slate)}>
        <row.Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-base font-semibold">{row.title}</span>
        <span className="truncate text-[13px] text-frenz-muted">{row.sub}</span>
      </span>
      {row.value ? <span className="max-w-[30%] shrink-0 truncate text-sm text-frenz-muted">{row.value}</span> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
    </Link>
  );
}
