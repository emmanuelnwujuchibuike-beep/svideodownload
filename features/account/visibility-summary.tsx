import { ChevronRight, Eye, EyeOff, Users } from "lucide-react";
import Link from "next/link";

import { countLevels, visibilityHeadline, type ExposureLevel, type VisibilityLine } from "@/lib/privacy/visibility";
import { cn } from "@/lib/utils";

/**
 * "Who can see you" — the Privacy Centre's summary (Part 19).
 *
 * Server component: a computed list of sentences and links. No client
 * JavaScript, and every line is derived at render from the same columns the
 * enforcement reads, so it cannot drift from the behaviour it describes.
 *
 * ── The tone is descriptive, not disapproving ────────────────────────────
 * Public settings are marked, not scolded. A screen that puts a warning
 * triangle next to "anyone can see your posts" is wrong for the many members
 * who intend exactly that, and it trains everyone to skim past the marks —
 * including the one that would have mattered. The icon distinguishes; it does
 * not judge.
 */
const LEVEL_TONE: Record<ExposureLevel, { icon: typeof Eye; className: string; label: string }> = {
  open: { icon: Eye, className: "text-blue-500", label: "Public" },
  limited: { icon: Users, className: "text-violet-500", label: "Limited" },
  closed: { icon: EyeOff, className: "text-emerald-500", label: "Private" },
};

export function VisibilitySummary({ lines }: { lines: VisibilityLine[] }) {
  const counts = countLevels(lines);

  return (
    <section className="mb-5">
      <div className="rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm">
        <h2 className="text-sm font-bold">Who can see you</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{visibilityHeadline(lines)}</p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(["open", "limited", "closed"] as ExposureLevel[]).map((level) => {
            const tone = LEVEL_TONE[level];
            const Icon = tone.icon;
            if (counts[level] === 0) return null;
            return (
              <span
                key={level}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold"
              >
                <Icon className={cn("h-3 w-3", tone.className)} />
                {counts[level]} {tone.label.toLowerCase()}
              </span>
            );
          })}
        </div>
      </div>

      <ul className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        {lines.map((line) => {
          const tone = LEVEL_TONE[line.level];
          const Icon = tone.icon;
          return (
            <li key={line.key} className="border-b border-border/60 last:border-0">
              <Link
                href={line.href}
                prefetch
                className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-secondary/40"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                  <Icon className={cn("h-4 w-4", tone.className)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{line.label}</span>
                  {/* The consequence in plain words — the whole reason this
                      screen exists. */}
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{line.statement}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
