import {
  CheckCircle2,
  Circle,
  CloudDownload,
  ListChecks,
  Medal,
  ShoppingBag,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { SoonButton } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

/* ── Stat cards ───────────────────────────────────────────────────────────── */
type Stat = {
  label: string;
  value: string;
  icon: LucideIcon;
  tile: string;
  suffix?: string;
  delta?: string;
  note?: string;
};

const STATS: Stat[] = [
  { label: "Wallet Balance", value: "₦245,000.50", icon: Wallet, tile: "from-violet-500 to-purple-600", delta: "+12.4%" },
  { label: "Reward Points", value: "15,430", icon: Medal, tile: "from-amber-400 to-orange-500", delta: "+8.2%" },
  { label: "Cloud Storage", value: "214 GB", suffix: "/ 1 TB", icon: CloudDownload, tile: "from-sky-500 to-blue-600", note: "21% Used" },
  { label: "Marketplace Sales", value: "₦840,000", icon: ShoppingBag, tile: "from-fuchsia-500 to-purple-600", delta: "+25.5%" },
];

export function StatsRow() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {STATS.map((s) => (
        <SoonButton
          key={s.label}
          feature={s.label}
          className="flex w-full items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition hover:border-border hover:bg-secondary/30"
        >
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", s.tile)}>
            <s.icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[11px] font-medium text-muted-foreground">{s.label}</span>
            <span className="mt-0.5 block truncate text-[15px] font-bold tracking-tight">
              {s.value}
              {s.suffix ? <span className="text-xs font-semibold text-muted-foreground"> {s.suffix}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {s.delta ? <span className="font-semibold text-emerald-500">{s.delta} </span> : null}
              {s.delta ? "this month" : s.note}
            </span>
          </span>
        </SoonButton>
      ))}
    </div>
  );
}

/* ── Earnings overview (chart) ────────────────────────────────────────────── */
// Illustrative month trend (design mock). x spreads across the viewBox, y is a
// 0..1 height from the bottom; converted to a smooth Catmull-Rom path.
const VALUES = [0.24, 0.34, 0.29, 0.47, 0.41, 0.57, 0.51, 0.69, 0.63, 0.82];
const CW = 340;
const CH = 120;
const PAD_Y = 10;
const POINTS: [number, number][] = VALUES.map((v, i) => [
  (i / (VALUES.length - 1)) * CW,
  CH - PAD_Y - v * (CH - PAD_Y * 2),
]);

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  const first = pts[0]!;
  const d = [`M ${first[0]} ${first[1]}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p0 = pts[i - 1] ?? p1;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`);
  }
  return d.join(" ");
}

const LINE = smoothPath(POINTS);
const AREA = `${LINE} L ${CW} ${CH} L 0 ${CH} Z`;
const last = POINTS[POINTS.length - 1]!;
const lastLeft = (last[0] / CW) * 100;
const lastTop = (last[1] / CH) * 100;

export function EarningsCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Earnings Overview</h2>
        <SoonButton
          feature="Earnings range"
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-secondary"
        >
          This Month
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </SoonButton>
      </div>

      <p className="mt-3 text-xl font-bold tracking-tight">₦245,000.50</p>
      <p className="text-sm font-semibold text-emerald-500">
        +28.5% <span className="font-normal text-muted-foreground">vs last month</span>
      </p>

      {/* Chart */}
      <div className="relative mt-4 h-40">
        <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="earn-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(262 83% 62%)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="hsl(262 83% 62%)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={AREA} fill="url(#earn-fill)" />
          <path d={LINE} fill="none" stroke="hsl(262 83% 58%)" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* Vertex dots */}
        {POINTS.map(([x, y], i) => {
          const isLast = i === POINTS.length - 1;
          return (
            <span
              key={i}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
                isLast ? "h-3 w-3 bg-violet-600 ring-4 ring-violet-500/25" : "h-2 w-2 bg-card ring-2 ring-violet-500",
              )}
              style={{ left: `${(x / CW) * 100}%`, top: `${(y / CH) * 100}%` }}
            />
          );
        })}

        {/* Tooltip near the peak */}
        <div
          className="absolute -translate-x-1/2 -translate-y-[130%] rounded-lg border border-border bg-card px-2.5 py-1.5 text-center shadow-md"
          style={{ left: `${lastLeft}%`, top: `${lastTop}%` }}
        >
          <p className="text-[10px] text-muted-foreground">May 26</p>
          <p className="text-xs font-bold">₦245,000.50</p>
        </div>
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>May 5</span>
        <span>May 12</span>
        <span>May 19</span>
        <span>May 26</span>
      </div>
    </div>
  );
}

/* ── Profile completion ───────────────────────────────────────────────────── */
const CHECKLIST = [
  { label: "Add profile picture", done: true },
  { label: "Add cover photo", done: true },
  { label: "Add bio", done: true },
  { label: "Add business link", done: true },
  { label: "Verify your account", done: false },
];

export function CompletionCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Profile Completion</h2>
        <ListChecks className="h-4 w-4 text-muted-foreground" />
      </div>

      <p className="mt-3 text-xl font-bold">
        80% <span className="text-sm font-semibold text-muted-foreground">Complete</span>
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: "80%" }} />
      </div>

      <ul className="mt-4 space-y-3">
        {CHECKLIST.map((c) => (
          <li key={c.label} className="flex items-center gap-2.5">
            {c.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-card" />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn("flex-1 text-sm", c.done ? "text-foreground" : "text-muted-foreground")}>{c.label}</span>
            {c.done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <SoonButton
                feature="Get verified"
                className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20"
              >
                Get verified
              </SoonButton>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Top performer ────────────────────────────────────────────────────────── */
export function TopPerformerCard({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-3xl border border-border/70 bg-card p-5 text-center shadow-card", className)}>
      <h2 className="w-full text-left text-sm font-bold">Top Performer</h2>

      <div className="relative my-3 flex h-20 w-20 items-center justify-center">
        <span aria-hidden className="absolute inset-0 rounded-full bg-amber-400/20 blur-xl" />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 text-white shadow-[0_10px_30px_-8px_rgba(245,158,11,0.6)] ring-4 ring-amber-200/40">
          <Trophy className="h-9 w-9 fill-white/90" />
        </span>
      </div>

      <p className="text-sm text-muted-foreground">You&apos;re in the top</p>
      <p className="text-2xl font-bold text-violet-600 dark:text-violet-400">3%</p>
      <p className="text-sm text-muted-foreground">of all creators</p>

      <SoonButton
        feature="Leaderboard"
        className="mt-4 w-full rounded-xl border border-border py-2.5 text-sm font-semibold transition hover:bg-secondary"
      >
        View Leaderboard
      </SoonButton>
    </div>
  );
}
