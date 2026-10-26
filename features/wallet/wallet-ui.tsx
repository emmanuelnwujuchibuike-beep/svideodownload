import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { EntryStatus } from "./api";
import { TapPending } from "./tap-pending";
import { ChevronLeftIcon, InfoIcon, LockIcon } from "./wallet-icons";

/*
  The Frenz Coin wallet's shared pieces, built from design/frenz-coin-wallet-design.zip: the 390 px screens' 16 px
  side margins, 22–30 px radii, Sora headings (`font-heading`) and Hanken Grotesk body (`.frenz-ui`), colours only from
  the `frenz-*` tokens. The page ground stays plain white (the screens' own ground).
*/

/** The screen root: the design's column, centred on wide screens. */
export function WalletScreen({ children, label }: { children: ReactNode; label: string }) {
  // the floating bottom nav covers the last ~5rem on phones: reserve it, or the page bottom is cut off (owner, 2026-10-25)
  return (
    <div className="frenz-ui mx-auto w-full max-w-[560px] bg-frenz-page pb-[calc(var(--frenz-nav-clearance,5rem)+1.5rem)] [font-variant-numeric:tabular-nums] lg:pb-6" aria-label={label}>
      {children}
    </div>
  );
}

/** A sub-screen header: "‹ Wallet" on the left, the title in the middle (design: Deposit / Transfer / Withdraw). */
export function SubHeader({ title, back = "/wallet", backLabel = "Wallet" }: { title: string; back?: string; backLabel?: string }) {
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center pl-2 pr-4 pt-3">
      <Link href={back} prefetch={false} className="flex h-11 touch-manipulation items-center gap-0.5 justify-self-start rounded-full px-2 text-base font-semibold text-frenz-violet outline-none transition active:opacity-60 focus-visible:ring-2 focus-visible:ring-frenz-blue">
        <TapPending size={16} className="mx-0.5">
          <ChevronLeftIcon size={20} strokeWidth={2.6} />
        </TapPending>
        {backLabel}
      </Link>
      <h1 className="font-heading text-[17px] font-bold tracking-[-0.3px] text-frenz-ink">{title}</h1>
      <span />
    </header>
  );
}

/** The design's dark hero card: ink ground, the brand glows, a hairline edge, two quiet rings. */
export function HeroCard({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <section
      aria-label={label}
      className={cn("relative mx-4 overflow-hidden rounded-[30px] px-[18px] pb-3.5 pt-5 text-white shadow-[0_30px_60px_-26px_hsl(var(--frenz-ink)/0.75)]", className)}
      style={{
        background:
          "radial-gradient(90% 70% at 100% 0%, hsl(var(--frenz-magenta) / 0.75) 0%, hsl(var(--frenz-magenta) / 0) 60%), radial-gradient(90% 80% at 0% 100%, hsl(var(--frenz-blue) / 0.85) 0%, hsl(var(--frenz-blue) / 0) 62%), radial-gradient(60% 50% at 55% 45%, hsl(var(--frenz-violet) / 0.55) 0%, hsl(var(--frenz-violet) / 0) 70%), hsl(247 21% 8%)",
      }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[30px] border border-white/15" />
      <span aria-hidden className="pointer-events-none absolute -right-[70px] -top-[90px] h-60 w-60 rounded-full border border-white/10" />
      <span aria-hidden className="pointer-events-none absolute -right-[30px] -top-[50px] h-40 w-40 rounded-full border border-white/[0.08]" />
      <div className="relative flex flex-col gap-[18px]">{children}</div>
    </section>
  );
}

/** The Frenz Coin mark: the brand-gradient ring around a white "F". */
export function CoinMark({ size = 30 }: { size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 rounded-full bg-frenz-gradient p-[2px]" style={{ width: size, height: size }}>
      <span className="flex flex-1 items-center justify-center rounded-full border-[1.5px] border-white/90 font-heading text-[13px] font-extrabold text-white">F</span>
    </span>
  );
}

type Tone = "gradient" | "ink" | "outline";
/** The design's 56 px pill buttons: the brand gradient (go), ink (confirm, withdraw) or outline. */
export function PillButton({ tone = "gradient", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      {...rest}
      className={cn(
        "flex h-14 w-full items-center justify-center gap-2 rounded-full font-heading text-base font-bold outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-frenz-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none",
        tone === "gradient" && "bg-frenz-gradient-x text-white shadow-[0_14px_28px_-12px_hsl(var(--frenz-violet)/0.7)]",
        tone === "ink" && "bg-frenz-ink text-frenz-page shadow-[0_14px_28px_-12px_hsl(var(--frenz-ink)/0.6)]",
        tone === "outline" && "h-12 border border-frenz-line bg-frenz-card font-body text-sm text-frenz-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** The design's bottom action bar — sticky inside the page, above the app's floating nav (never under it). */
export function ActionBar({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--frenz-nav-clearance,4.5rem)+0.5rem)] z-10 mx-0 mt-6 flex flex-col items-center gap-2.5 border-t border-frenz-line bg-frenz-page/90 px-4 pb-4 pt-4 backdrop-blur-xl lg:bottom-4">
      {children}
      {hint ? <span className="flex items-center gap-1.5 text-center text-xs text-frenz-muted">{hint}</span> : null}
    </div>
  );
}

/** A section heading inside a screen (design: "Pay with", "Summary", "Activity"). */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between px-5 pb-2.5 pt-6">
      <h2 className="font-heading text-[19px] font-bold tracking-[-0.4px] text-frenz-ink">{children}</h2>
      {action}
    </div>
  );
}

/** The design's summary list on the soft fill (Summary / Receipt details). */
export function DetailList({ rows, total, className }: { rows: [ReactNode, ReactNode][]; total?: [ReactNode, ReactNode]; className?: string }) {
  return (
    <dl className={cn("mx-4 flex flex-col rounded-[22px] bg-frenz-fill/60 px-4 py-1", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className={cn("flex items-center justify-between gap-3 py-[11px] text-sm", i > 0 && "border-t border-frenz-line")}>
          <dt className="text-frenz-muted">{k}</dt>
          <dd className="text-right font-bold text-frenz-ink">{v}</dd>
        </div>
      ))}
      {total ? (
        <div className="flex items-center justify-between gap-3 border-t border-frenz-line py-[13px] text-[15px]">
          <dt className="font-bold text-frenz-ink">{total[0]}</dt>
          <dd className="font-heading font-extrabold text-frenz-ink">{total[1]}</dd>
        </div>
      ) : null}
    </dl>
  );
}

const STATUS: Record<EntryStatus | "rejected" | "cancelled" | "approved" | "reviewing", { label: string; cls: string }> = {
  pending: { label: "On hold", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  held: { label: "Held", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  processing: { label: "Processing", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  reviewing: { label: "In review", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  approved: { label: "Approved", cls: "bg-frenz-blue/10 text-frenz-blue" },
  completed: { label: "Completed", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  reversed: { label: "Reversed", cls: "bg-frenz-fill text-frenz-muted" },
  returned: { label: "Returned by bank", cls: "bg-frenz-fill text-frenz-muted" },
  rejected: { label: "Not completed", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
  cancelled: { label: "Cancelled", cls: "bg-frenz-fill text-frenz-muted" },
};
/** A small status chip (design: "Processing", "Completed"). */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status as keyof typeof STATUS] ?? { label: status, cls: "bg-frenz-fill text-frenz-muted" };
  return <span className={cn("inline-flex h-[18px] items-center rounded-full px-[7px] text-[11px] font-bold", s.cls, className)}>{s.label}</span>;
}

/** An inline notice: information (fill), caution (amber) or a problem (rose). `role` makes errors announced. */
export function Notice({ tone = "info", children, title, className, action }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; title?: string; className?: string; action?: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "mx-4 flex gap-2.5 rounded-[18px] px-3.5 py-3 text-[13px] leading-snug",
        tone === "info" && "bg-frenz-fill text-frenz-ink",
        tone === "warn" && "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
        tone === "error" && "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200",
        tone === "success" && "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200",
        className,
      )}
    >
      <InfoIcon size={18} className="mt-px shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? <strong className="font-bold">{title}</strong> : null}
        <span>{children}</span>
        {action}
      </div>
    </div>
  );
}

/** The whole wallet (or one of its flows) is not available: said plainly, with no money controls at all. */
export function Unavailable({ title, children, action }: { title: string; children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="mx-4 mt-6 flex flex-col items-center gap-3 rounded-[26px] border border-frenz-line px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-frenz-fill text-frenz-violet">
        <LockIcon size={24} />
      </span>
      <h2 className="font-heading text-lg font-bold text-frenz-ink">{title}</h2>
      <p className="max-w-[34ch] text-sm text-frenz-muted">{children}</p>
      {action ? (
        <Link href={action.href} prefetch={false} className="mt-2 flex h-12 touch-manipulation items-center gap-2 rounded-full bg-frenz-gradient-x px-6 font-heading text-[15px] font-bold text-white outline-none transition active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-frenz-blue focus-visible:ring-offset-2 motion-reduce:transition-none">
          <TapPending size={16}>{null}</TapPending>
          {action.label}
        </Link>
      ) : null}
      <Link href="/wallet" prefetch={false} className="mt-1 flex min-h-11 touch-manipulation items-center gap-1.5 text-sm font-bold text-frenz-violet underline-offset-4 active:opacity-60 hover:underline">
        <TapPending size={14}>{null}</TapPending>
        Back to wallet
      </Link>
    </div>
  );
}

/** A 401 from the API: the session ended. Never a generic error. */
export function SessionExpired({ next }: { next: string }) {
  return (
    <Notice tone="warn" title="Your session ended" action={<Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold underline underline-offset-4">Sign in again</Link>}>
      Nothing was changed. Sign in again to continue.
    </Notice>
  );
}

/**
 * The 6-digit transaction PIN field: masked, digits only, one-time (no autofill, no autocorrect). The value is held by
 * the caller and sent once; it is never stored, logged or shown.
 */
export function PinField({ id, label, value, onChange, autoFocus, disabled, describedBy }: { id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; disabled?: boolean; describedBy?: string }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-frenz-muted">{label}</span>
      <input
        id={id}
        type="password"
        data-large-text
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        pattern="[0-9]*"
        maxLength={6}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="h-14 rounded-2xl bg-frenz-fill px-4 text-center font-heading !text-2xl font-bold tracking-[0.6em] text-frenz-ink outline-none placeholder:text-frenz-muted focus-visible:ring-2 focus-visible:ring-frenz-blue disabled:opacity-60"
        placeholder="••••••"
      />
    </label>
  );
}

/** The design's big centred amount entry (Transfer / Withdraw: 54 px Sora). */
export function AmountEntry({ id, label, value, onChange, hint, dark, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; dark?: boolean; disabled?: boolean }) {
  return (
    <section aria-label={label} className="flex flex-col items-center gap-1.5">
      <label htmlFor={id} className={cn("text-[13px] font-semibold", dark ? "text-white/70" : "text-frenz-muted")}>
        {label}
      </label>
      {/* "FC" leads like a currency symbol, raised to the figure's cap line; the field is as wide as what's typed */}
      <span className="flex max-w-full items-start justify-center gap-1.5 font-heading leading-none [font-variant-numeric:tabular-nums]">
        <span aria-hidden className={cn("pt-[6px] text-[22px] font-extrabold tracking-[-0.02em]", dark ? "text-white/70" : "text-frenz-muted")}>FC</span>
        <input
          size={1}
          data-large-text
          style={{ width: `calc(${Math.max(1, value.length)}ch + 4px)` }}
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={value}
          placeholder="0"
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 12))}
          className={cn(
            "min-w-[1ch] max-w-[min(70vw,260px)] border-none bg-transparent p-0 text-left font-heading !text-[52px] font-extrabold leading-none tracking-normal outline-none placeholder:opacity-40 focus-visible:underline focus-visible:decoration-2 focus-visible:underline-offset-8",
            dark ? "text-white placeholder:text-white" : "text-frenz-ink placeholder:text-frenz-muted",
          )}
        />
      </span>
      {hint ? <span className={cn("text-sm font-semibold", dark ? "text-white/80" : "text-frenz-muted")}>{hint}</span> : null}
    </section>
  );
}
