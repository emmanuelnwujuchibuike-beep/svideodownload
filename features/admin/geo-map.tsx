"use client";

import { useMemo, useState } from "react";

import type { Breakdown } from "@/lib/analytics/queries";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * Geographic distribution of visitors — a proportional bubble map on an
 * equirectangular (lon/lat) grid. Self-contained (no map tiles, no external
 * requests): each country is plotted at its approximate centroid, bubble area ∝
 * visitor count, with a ranked legend beside it. Countries without a known
 * centroid still appear in the legend. Pure SVG + transforms — no idle animation.
 */

// Approx centroids [lat, lon] + display name for the countries we commonly see.
const CENTROIDS: Record<string, { lat: number; lon: number; name: string }> = {
  US: { lat: 38, lon: -97, name: "United States" },
  GB: { lat: 54, lon: -2, name: "United Kingdom" },
  CA: { lat: 56, lon: -106, name: "Canada" },
  NG: { lat: 9, lon: 8, name: "Nigeria" },
  IN: { lat: 21, lon: 78, name: "India" },
  DE: { lat: 51, lon: 10, name: "Germany" },
  FR: { lat: 46, lon: 2, name: "France" },
  BR: { lat: -10, lon: -55, name: "Brazil" },
  NL: { lat: 52, lon: 5, name: "Netherlands" },
  ES: { lat: 40, lon: -4, name: "Spain" },
  IT: { lat: 42, lon: 12, name: "Italy" },
  AU: { lat: -25, lon: 133, name: "Australia" },
  ZA: { lat: -29, lon: 24, name: "South Africa" },
  KE: { lat: 0, lon: 38, name: "Kenya" },
  GH: { lat: 8, lon: -1, name: "Ghana" },
  EG: { lat: 27, lon: 30, name: "Egypt" },
  SA: { lat: 24, lon: 45, name: "Saudi Arabia" },
  AE: { lat: 24, lon: 54, name: "UAE" },
  PK: { lat: 30, lon: 70, name: "Pakistan" },
  BD: { lat: 24, lon: 90, name: "Bangladesh" },
  ID: { lat: -2, lon: 118, name: "Indonesia" },
  PH: { lat: 13, lon: 122, name: "Philippines" },
  JP: { lat: 36, lon: 138, name: "Japan" },
  KR: { lat: 37, lon: 128, name: "South Korea" },
  CN: { lat: 35, lon: 105, name: "China" },
  RU: { lat: 61, lon: 105, name: "Russia" },
  MX: { lat: 23, lon: -102, name: "Mexico" },
  AR: { lat: -34, lon: -64, name: "Argentina" },
  CO: { lat: 4, lon: -73, name: "Colombia" },
  CL: { lat: -30, lon: -71, name: "Chile" },
  PE: { lat: -10, lon: -76, name: "Peru" },
  SE: { lat: 62, lon: 15, name: "Sweden" },
  NO: { lat: 62, lon: 10, name: "Norway" },
  FI: { lat: 64, lon: 26, name: "Finland" },
  DK: { lat: 56, lon: 10, name: "Denmark" },
  PL: { lat: 52, lon: 20, name: "Poland" },
  UA: { lat: 49, lon: 32, name: "Ukraine" },
  TR: { lat: 39, lon: 35, name: "Turkey" },
  IR: { lat: 32, lon: 53, name: "Iran" },
  MA: { lat: 32, lon: -6, name: "Morocco" },
  DZ: { lat: 28, lon: 3, name: "Algeria" },
  ET: { lat: 8, lon: 38, name: "Ethiopia" },
  TZ: { lat: -6, lon: 35, name: "Tanzania" },
  UG: { lat: 1, lon: 32, name: "Uganda" },
  CM: { lat: 6, lon: 12, name: "Cameroon" },
  CI: { lat: 8, lon: -5, name: "Côte d'Ivoire" },
  SN: { lat: 14, lon: -14, name: "Senegal" },
  PT: { lat: 39, lon: -8, name: "Portugal" },
  IE: { lat: 53, lon: -8, name: "Ireland" },
  BE: { lat: 51, lon: 4, name: "Belgium" },
  CH: { lat: 47, lon: 8, name: "Switzerland" },
  AT: { lat: 47, lon: 13, name: "Austria" },
  GR: { lat: 39, lon: 22, name: "Greece" },
  CZ: { lat: 50, lon: 15, name: "Czechia" },
  RO: { lat: 46, lon: 25, name: "Romania" },
  HU: { lat: 47, lon: 20, name: "Hungary" },
  NZ: { lat: -42, lon: 174, name: "New Zealand" },
  SG: { lat: 1, lon: 104, name: "Singapore" },
  MY: { lat: 4, lon: 102, name: "Malaysia" },
  TH: { lat: 15, lon: 100, name: "Thailand" },
  VN: { lat: 16, lon: 108, name: "Vietnam" },
  HK: { lat: 22, lon: 114, name: "Hong Kong" },
  TW: { lat: 24, lon: 121, name: "Taiwan" },
  IL: { lat: 31, lon: 35, name: "Israel" },
  QA: { lat: 25, lon: 51, name: "Qatar" },
  KW: { lat: 29, lon: 47, name: "Kuwait" },
  VE: { lat: 8, lon: -66, name: "Venezuela" },
  EC: { lat: -1, lon: -78, name: "Ecuador" },
  RS: { lat: 44, lon: 21, name: "Serbia" },
  HR: { lat: 45, lon: 15, name: "Croatia" },
  BG: { lat: 43, lon: 25, name: "Bulgaria" },
  IS: { lat: 65, lon: -18, name: "Iceland" },
};

const W = 720;
const H = 360;

function project(lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H };
}

export function GeoMap({ rows }: { rows: Breakdown[] }) {
  const [hover, setHover] = useState<string | null>(null);

  const { plotted, max, total } = useMemo(() => {
    const known = rows.filter((r) => r.key !== "Unknown");
    const max = Math.max(1, ...known.map((r) => r.count));
    const total = rows.reduce((s, r) => s + r.count, 0);
    const plotted = known
      .map((r) => {
        const c = CENTROIDS[r.key.toUpperCase()];
        if (!c) return null;
        const p = project(c.lat, c.lon);
        return { code: r.key.toUpperCase(), name: c.name, count: r.count, ...p };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => b.count - a.count);
    return { plotted, max, total };
  }, [rows]);

  const nameFor = (code: string) => CENTROIDS[code.toUpperCase()]?.name ?? code;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-xs text-muted-foreground">
        No geographic data yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm lg:grid-cols-[1fr,220px]">
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-b from-sky-500/[0.06] to-indigo-500/[0.06] ring-1 ring-inset ring-border/40">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Visitor world map">
          {/* graticule */}
          {[...Array(11)].map((_, i) => {
            const x = (i / 11) * W;
            return <line key={`v${i}`} x1={x} y1={0} x2={x} y2={H} stroke="currentColor" className="text-border/25" strokeWidth={0.5} />;
          })}
          {[...Array(6)].map((_, i) => {
            const y = (i / 6) * H;
            return <line key={`h${i}`} x1={0} y1={y} x2={W} y2={y} stroke="currentColor" className="text-border/25" strokeWidth={0.5} />;
          })}
          {/* equator emphasized */}
          <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="currentColor" className="text-border/40" strokeWidth={0.8} strokeDasharray="4 4" />
          {plotted.map((p) => {
            const r = 4 + Math.sqrt(p.count / max) * 22;
            const active = hover === p.code;
            return (
              <g key={p.code} onMouseEnter={() => setHover(p.code)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                <circle cx={p.x} cy={p.y} r={r} className={cn("fill-blue-500/25 transition", active && "fill-blue-500/40")} />
                <circle cx={p.x} cy={p.y} r={Math.max(2, r * 0.32)} className="fill-blue-500" />
                {active ? (
                  <g>
                    <rect x={p.x + 8} y={p.y - 20} width={Math.max(72, p.name.length * 6.6)} height={26} rx={5} className="fill-foreground/90" />
                    <text x={p.x + 14} y={p.y - 3} className="fill-background text-[11px] font-semibold" style={{ fontSize: 11 }}>
                      {p.name} · {formatCompactNumber(p.count)}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="space-y-1.5 self-start">
        <li className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <span>Top countries</span>
          <span className="tabular-nums">{formatCompactNumber(total)}</span>
        </li>
        {rows.slice(0, 8).map((r) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          const code = r.key.toUpperCase();
          return (
            <li
              key={r.key}
              onMouseEnter={() => setHover(code)}
              onMouseLeave={() => setHover(null)}
              className={cn("rounded-lg px-2 py-1 transition", hover === code && "bg-secondary")}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-medium">{r.key === "Unknown" ? "Unknown" : nameFor(code)}</span>
                <span className="tabular-nums text-muted-foreground">{pct}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-600" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
