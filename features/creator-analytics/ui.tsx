"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { useQuery } from "@/features/data";
import { Spinner, TapPending } from "@/features/wallet/tap-pending";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { type AnalyticsPeriod, PERIOD_LABEL, signed } from "@/lib/creator-analytics/format";

/*
  Creator analytics building blocks (design/creator-analytics.html): page head, the native-style back link labelled
  with the parent screen, the period control, glass cards, heroes, change badges, tiles, tips, skeletons in each
  card's real shape, per-card errors with retry and friendly empty states.

  Owner rules applied here: every link that opens a screen answers the tap instantly (TapPending spinner); only the
  overview's main cards prefetch; every section's data is cached per period (features/data useQuery), so going back
  or switching to a period seen before shows at once while a fresh read replaces it.
*/

// ── data ──────────────────────────────────────────────────────────────────────

/** The creator's time zone (heatmaps, local days). */
export function useTimeZone(): string {
  const [tz, setTz] = useState("UTC");
  useEffect(() => {
    try {
      setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      /* UTC */
    }
  }, []);
  return tz;
}

export class AnalyticsError extends Error {}

/** One section's read, cached per section + parameters (stale-while-revalidate). */
export function useAnalytics<T>(section: string, params: Record<string, string | number | null | undefined>, enabled = true) {
  const tz = useTimeZone();
  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries({ ...params, tz })) if (v !== null && v !== undefined && v !== "") pairs.push([k, String(v)]);
  const qs = new URLSearchParams(pairs).toString();
  return useQuery<T>(
    `ca:${section}:${qs}`,
    async () => {
      let res: Response;
      try {
        res = await fetch(`/api/creator-analytics/${section}?${qs}`, { credentials: "same-origin", cache: "no-store" });
      } catch {
        throw new AnalyticsError("Couldn't reach the server. Check your connection.");
      }
      const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (!res.ok || !body) throw new AnalyticsError(body?.error ?? "Couldn't load this right now.");
      return body;
    },
    { enabled, revalidateOnFocus: false },
  );
}

// ── page chrome ─────────────────────────────────────────────────────────────

/** The soft colour blobs behind every screen (blue + violet, the third tinted per page). */
export function Blobs({ third }: { third?: "magenta" | "amber" | "sky" }) {
  const c = third === "magenta" ? "219,39,119" : third === "amber" ? "245,158,11" : third === "sky" ? "14,165,233" : null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[480px] overflow-hidden">
      <div className="absolute -left-20 -top-28 h-[360px] w-[360px] rounded-full" style={{ background: "radial-gradient(circle,rgba(37,99,235,.16),transparent 70%)" }} />
      <div className="absolute -right-28 -top-14 h-[380px] w-[380px] rounded-full" style={{ background: "radial-gradient(circle,rgba(124,58,237,.13),transparent 70%)" }} />
      {c ? <div className="absolute left-1/3 top-40 h-[300px] w-[300px] rounded-full" style={{ background: `radial-gradient(circle,rgba(${c},.13),transparent 70%)` }} /> : null}
    </div>
  );
}

/** The native back button, labelled with the parent screen's name. Answers the tap at once. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <nav className="relative px-2 pt-2">
      <Link href={href} className="inline-flex h-11 min-w-11 items-center gap-0.5 rounded-xl px-2 text-[17px] font-medium text-[var(--ca-blue)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-blue)]">
        <TapPending size={18}>
          <ChevronLeft className="h-6 w-6" aria-hidden strokeWidth={2.4} />
        </TapPending>
        {label}
      </Link>
    </nav>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative px-5 pt-2.5">
      {children}
      <h1 className="m-0 text-[34px] font-extrabold leading-[1.1] tracking-[-1.1px]">{title}</h1>
      {sub ? <p className="mt-1.5 text-[15px] text-[var(--ca-sub)]">{sub}</p> : null}
    </section>
  );
}

/** 7D / 30D / 90D / 1Y — the selected segment dark ink with white text. Changing it re-reads (or reuses the cache). */
export function PeriodControl({ value, onChange, periods }: { value: AnalyticsPeriod; onChange: (p: AnalyticsPeriod) => void; periods: readonly AnalyticsPeriod[] }) {
  return (
    <div role="tablist" aria-label="Time period" className="relative mx-4 mt-[18px] grid gap-1 rounded-2xl border border-white bg-white/60 p-1 backdrop-blur-xl" style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0,1fr))` }}>
      {periods.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === value}
          onClick={() => {
            if (p === value) return;
            haptic("selection");
            onChange(p);
          }}
          className={cn("h-[38px] min-h-11 rounded-xl text-sm font-bold transition-colors", p === value ? "bg-[var(--ca-ink)] text-white shadow-[0_4px_12px_rgba(14,15,20,.2)]" : "text-[var(--ca-sub)]")}
        >
          {PERIOD_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="relative flex items-baseline justify-between px-5 pt-7">
      <h2 className="m-0 text-[21px] font-extrabold tracking-[-0.5px]">{title}</h2>
      {aside ? <span className="text-[13px] text-[var(--ca-sub)]">{aside}</span> : null}
    </div>
  );
}

// ── cards ─────────────────────────────────────────────────────────────────

const CARD = "relative mx-4 mt-3 block rounded-[26px] p-[18px] text-[var(--ca-ink)] no-underline";

/** A glass card; with `href` it is a link that presses to 0.98 and spins on tap. */
export function Card({ href, children, className, style, label, prefetch }: { href?: string; children: ReactNode; className?: string; style?: React.CSSProperties; label?: string; prefetch?: boolean }) {
  if (!href)
    return (
      <section className={cn(CARD, "ca-glass", className)} style={style} aria-label={label}>
        {children}
      </section>
    );
  return (
    <Link href={href} prefetch={prefetch ? undefined : false} aria-label={label} className={cn(CARD, "ca-glass min-h-11 transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-blue)]", className)} style={style}>
      {children}
    </Link>
  );
}

/** The chevron on a linked card — the spinner the instant it is tapped. */
export function Chevron({ color = "#9A9CA8" }: { color?: string }) {
  return (
    <span className="flex h-5 w-5 flex-none items-center justify-center" style={{ color }}>
      <TapPending size={16}>
        <ChevronRight className="h-4 w-4" aria-hidden strokeWidth={2.4} />
      </TapPending>
    </span>
  );
}

export function CardHead({ icon, iconBg, title, caption, captionColor, chevronColor, linked }: { icon: ReactNode; iconBg: string; title: string; caption?: string; captionColor?: string; chevronColor?: string; linked?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-[13px]" style={{ background: iconBg }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold">{title}</span>
        {caption ? <span className="block text-[13px]" style={{ color: captionColor ?? "var(--ca-sub)" }}>{caption}</span> : null}
      </span>
      {linked ? <Chevron color={chevronColor} /> : null}
    </div>
  );
}

export function Hero({ children, background, className, glow = "rgba(124,58,237,.45)", label }: { children: ReactNode; background: string; className?: string; glow?: string; label?: string }) {
  return (
    <section aria-label={label} className={cn("relative mx-4 mt-3.5 overflow-hidden rounded-[28px] p-5 text-white", className)} style={{ background, boxShadow: "var(--ca-shadow-hero)" }}>
      <div aria-hidden className="absolute -right-16 -top-20 h-60 w-60 rounded-full" style={{ background: `radial-gradient(circle,${glow},transparent 70%)` }} />
      <div className="relative">{children}</div>
    </section>
  );
}

/** "+12.4%" — green up, red down, always with its sign (never colour alone). */
export function Delta({ value, dark, unit = "%", suffix }: { value: number | null; dark?: boolean; unit?: string; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value > 0.05;
  const down = value < -0.05;
  const cls = dark
    ? up ? "bg-[var(--ca-up-dark-bg)] text-[var(--ca-up-dark)]" : down ? "bg-[var(--ca-down-dark-bg)] text-[var(--ca-down-dark)]" : "bg-white/10 text-white/80"
    : up ? "bg-[var(--ca-up-bg)] text-[var(--ca-up)]" : down ? "bg-[var(--ca-down-bg)] text-[var(--ca-down)]" : "bg-[var(--ca-chip)] text-[var(--ca-sub)]";
  return (
    <span className={cn("inline-flex h-6 items-center rounded-xl px-2.5 text-[13px] font-bold", cls)}>
      {up ? "▲ " : down ? "▼ " : ""}
      {signed(value, unit)}
      {suffix ? <span className="ml-1 font-semibold opacity-80">{suffix}</span> : null}
    </span>
  );
}

export function Stat3({ items, dark, borderColor }: { items: { v: ReactNode; l: string }[]; dark?: boolean; borderColor?: string }) {
  const line = borderColor ?? (dark ? "rgba(255,255,255,.12)" : "var(--ca-line)");
  return (
    <div className="mt-4 grid grid-cols-3 border-t pt-3.5" style={{ borderColor: line }}>
      {items.map((it, i) => (
        <div key={it.l} className={cn("min-w-0", i > 0 && "border-l pl-3.5")} style={{ borderColor: line }}>
          <div className="break-words text-lg font-bold">{it.v}</div>
          <div className={cn("mt-0.5 text-xs", dark ? "text-white/70" : "text-[var(--ca-sub)]")}>{it.l}</div>
        </div>
      ))}
    </div>
  );
}

export function Tile({ v, l, d, href, children }: { v?: ReactNode; l: string; d?: ReactNode; href?: string; children?: ReactNode }) {
  const body = (
    <>
      {v !== undefined ? <span className="break-words text-[21px] font-extrabold tracking-[-0.6px]">{v}</span> : null}
      <span className="mt-0.5 text-xs leading-snug text-[var(--ca-sub)]">{l}</span>
      {d ? <span className="mt-1.5 text-xs font-bold">{d}</span> : null}
      {children}
    </>
  );
  const cls = "flex min-h-11 flex-col rounded-[20px] border border-white bg-[var(--ca-glass)] px-3 py-3.5 text-[var(--ca-ink)] no-underline shadow-[0_6px_18px_rgba(16,18,40,.05)]";
  return href ? (
    <Link href={href} prefetch={false} className={cn(cls, "transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-blue)]")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Tip({ icon, title, text, href, tone = "blue" }: { icon: ReactNode; title: string; text: string; href?: string; tone?: "blue" | "violet" | "amber" | "magenta" }) {
  const bg = { blue: "rgba(234,241,255,.85)", violet: "rgba(241,235,255,.85)", amber: "rgba(255,244,219,.85)", magenta: "rgba(252,231,243,.85)" }[tone];
  const body = (
    <>
      <span aria-hidden className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px]">{title}</b>
        <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#4A4C5A]">{text}</span>
      </span>
      {href ? <Chevron /> : null}
    </>
  );
  const cls = "relative mx-4 mt-3 flex items-start gap-3 rounded-[22px] border border-white px-[18px] py-4 text-[var(--ca-ink)] no-underline";
  return href ? (
    <Link href={href} prefetch={false} className={cn(cls, "min-h-11 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-blue)]")} style={{ background: bg }}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={{ background: bg }}>
      {body}
    </div>
  );
}

// ── states ────────────────────────────────────────────────────────────────

export function Skel({ className }: { className?: string }) {
  return <div aria-hidden className={cn("ca-skel rounded-xl", className)} />;
}

/** A card-shaped skeleton (the real card's layout, shimmering). */
export function CardSkeleton({ hero, lines = 2, chart = true }: { hero?: boolean; lines?: number; chart?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={cn("relative mx-4 mt-3 rounded-[26px] p-[18px]", hero ? "bg-[#1C1A3D]/90" : "ca-glass")}>
      <Skel className="h-5 w-40" />
      <Skel className="mt-3 h-9 w-32" />
      {Array.from({ length: lines }, (_, i) => (
        <Skel key={i} className="mt-2.5 h-3.5 w-full" />
      ))}
      {chart ? <Skel className="mt-4 h-16 w-full" /> : null}
    </div>
  );
}

/** One card failed: say so in place, with a retry — the rest of the page stays. */
export function CardError({ message, onRetry, busy }: { message: string; onRetry: () => void; busy?: boolean }) {
  return (
    <div role="alert" className="ca-glass relative mx-4 mt-3 flex items-center gap-3 rounded-[26px] p-[18px] text-sm">
      <span className="min-w-0 flex-1 text-[var(--ca-sub)]">{message}</span>
      <button type="button" onClick={onRetry} disabled={busy} aria-busy={busy} className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-[var(--ca-ink)] px-4 font-semibold text-white disabled:opacity-60">
        {busy ? <Spinner size={14} /> : null}
        Retry
      </button>
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: { label: string; href: string } }) {
  return (
    <div className="ca-glass relative mx-4 mt-3 rounded-[26px] p-6 text-center">
      <p className="text-[15px] font-bold">{title}</p>
      {text ? <p className="mt-1 text-[13px] text-[var(--ca-sub)]">{text}</p> : null}
      {action ? (
        <Link href={action.href} className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-[var(--ca-ink)] px-5 text-sm font-semibold text-white">
          <TapPending size={14}>{action.label}</TapPending>
        </Link>
      ) : null}
    </div>
  );
}

/** Loading → skeleton; failed with nothing cached → error card with retry; otherwise the content. */
export function Section<T>({ q, skeleton, children }: { q: { data: T | undefined; error: unknown; isLoading: boolean; isValidating: boolean; refetch: () => Promise<T> }; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  if (q.data !== undefined) return <>{children(q.data)}</>;
  if (q.error) return <CardError message={q.error instanceof Error ? q.error.message : "Couldn't load this right now."} onRetry={() => void q.refetch().catch(() => {})} busy={q.isValidating} />;
  return <>{skeleton}</>;
}
