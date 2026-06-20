"use client";

import { useEffect, useState } from "react";

interface Stat {
  label: string;
  target: number;
  format: (n: number) => string;
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const STATS: Stat[] = [
  { label: "Downloads served", target: 4_200_000, format: (n) => compact.format(n) },
  { label: "Platforms", target: 1000, format: (n) => `${Math.round(n)}+` },
  { label: "Avg. processing", target: 2.8, format: (n) => `${n.toFixed(1)}s` },
  { label: "Uptime", target: 99.9, format: (n) => `${n.toFixed(1)}%` },
];

export function StatsCounter() {
  return (
    <dl className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
      {STATS.map((s) => (
        <StatItem key={s.label} {...s} />
      ))}
    </dl>
  );
}

function StatItem({ label, target, format }: Stat) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 1600;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-3 text-center backdrop-blur transition-colors hover:border-primary/40">
      <dd className="text-2xl font-bold text-gradient tabular-nums">{format(value)}</dd>
      <dt className="mt-0.5 text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
