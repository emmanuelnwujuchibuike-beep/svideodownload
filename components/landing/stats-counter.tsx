"use client";

import { Download, Globe, Heart, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Stat {
  icon: typeof Download;
  label: string;
  target: number;
  format: (n: number) => string;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 0 });

const STATS: Stat[] = [
  { icon: Download, label: "Videos Downloaded", target: 35_000_000, format: (n) => `${compact.format(n)}+` },
  { icon: Users, label: "Community Members", target: 8_000_000, format: (n) => `${compact.format(n)}+` },
  { icon: Globe, label: "Countries", target: 120, format: (n) => `${Math.round(n)}+` },
  { icon: Heart, label: "Success Rate", target: 99.9, format: (n) => `${n.toFixed(1)}%` },
];

export function StatsCounter() {
  return (
    <section className="container max-w-6xl py-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-900 p-8 shadow-elevated sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-violet-500/20 blur-3xl" />
        <dl className="relative grid grid-cols-2 gap-6 sm:grid-cols-4">
          {STATS.map((s) => (
            <StatItem key={s.label} {...s} />
          ))}
        </dl>
      </div>
    </section>
  );
}

function StatItem({ icon: Icon, label, target, format }: Stat) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || started.current) return;
        started.current = true;
        const start = performance.now();
        const duration = 1600;
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setValue(target * eased);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);

  return (
    <div ref={ref} className="flex items-center gap-3 text-white">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-violet-300 ring-1 ring-white/10">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <dd className="text-2xl font-extrabold tabular-nums sm:text-3xl">{format(value)}</dd>
        <dt className="text-xs text-white/60">{label}</dt>
      </div>
    </div>
  );
}
