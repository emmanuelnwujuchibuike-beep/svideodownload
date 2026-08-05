import { AlertTriangle, ArrowRight, Check, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { BAND_LABEL, type SecurityScore } from "@/lib/security/score";
import { cn } from "@/lib/utils";

/**
 * The Security Score, at the top of the security screen (Part 19).
 *
 * Server component — an SVG arc and a list. No client JavaScript, no charting
 * library, and it is already in the HTML when the page paints.
 *
 * ── The number is never alone ────────────────────────────────────────────
 * A ring on its own is unreadable to a screen reader and ambiguous to anyone
 * who cannot separate the colours, so the score is stated as a number, the
 * band is spelled out in words, and every gap is a sentence saying what it
 * actually prevents. Same discipline as the Profile Health ring in Part 15.
 *
 * ── Colour follows the BAND, not the number ──────────────────────────────
 * `band` is already capped by open critical gaps, so an account sitting on a
 * respectable total with no second factor shows amber rather than green. The
 * colour cannot disagree with the assessment because it is derived from it.
 */
const BAND_TONE: Record<SecurityScore["band"], { ring: string; text: string; chip: string }> = {
  "at-risk": { ring: "#f43f5e", text: "text-rose-500", chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  basic: { ring: "#f59e0b", text: "text-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  good: { ring: "#2563FF", text: "text-blue-500", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  strong: {
    ring: "#10b981",
    text: "text-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

export function SecurityScoreCard({ result }: { result: SecurityScore }) {
  const tone = BAND_TONE[result.band];
  const size = 108;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (result.score / 100) * circumference;

  return (
    <section className="border-b border-border/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Security score ${result.score} out of 100 — ${BAND_LABEL[result.band]}`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              className="text-secondary"
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={tone.ring}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </svg>
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums">{result.score}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">of 100</span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <ShieldCheck className={cn("h-[18px] w-[18px]", tone.text)} />
            Security score
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", tone.chip)}>
              {BAND_LABEL[result.band]}
            </span>
          </h2>

          {result.gaps.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Everything we check is in place. Nothing to do.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {result.gaps.filter((g) => g.severity === "critical").length > 0
                ? "One thing here would stop a stolen password on its own."
                : "A couple of optional improvements left."}
            </p>
          )}

          {result.strengths.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {result.strengths.map((s) => (
                <li key={s} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-3 w-3 text-emerald-500" /> {s}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {result.gaps.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {result.gaps.map((gap) => (
            <li key={gap.key}>
              <Link
                href={gap.href}
                className="flex items-start gap-3 rounded-2xl bg-secondary/40 px-3.5 py-3 transition hover:bg-secondary/70"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    gap.severity === "critical"
                      ? "bg-rose-500/12 text-rose-500"
                      : "bg-amber-500/12 text-amber-500",
                  )}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{gap.title}</span>
                  {/* The reason it matters, not a generic nudge — a security
                      screen that says "improve your security" teaches people to
                      ignore it. */}
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{gap.why}</span>
                </span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
