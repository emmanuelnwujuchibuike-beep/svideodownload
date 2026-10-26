import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/* Small shared pieces for the Frenz Coin console — the dashboard's own card / text tokens, no new design system. */

export const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const TONES = {
  amber: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  blue: "bg-blue-500/10 text-blue-800 dark:text-blue-300",
  green: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  rose: "bg-rose-500/10 text-rose-800 dark:text-rose-300",
  gray: "bg-muted text-muted-foreground",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", TONES[tone])}>{children}</span>;
}

export function Card({ title, children, action, className }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-border bg-card px-4 py-5 shadow-card sm:px-6", className)}>
      {title || action ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h3 className="text-base font-semibold">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Message({ kind, children }: { kind: "ok" | "error" | "info"; children: ReactNode }) {
  return (
    <p role={kind === "error" ? "alert" : "status"} className={cn("rounded-xl px-3 py-2 text-sm", kind === "ok" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300", kind === "error" && "bg-rose-500/10 text-rose-800 dark:text-rose-300", kind === "info" && "bg-muted text-muted-foreground")}>
      {children}
    </p>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-600">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const INPUT = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60";
export const BTN = "inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function Toggle({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
