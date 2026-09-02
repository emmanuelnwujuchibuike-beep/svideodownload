import Link from "next/link";

import { universePoint, type UniverseGraph, type UniverseNodeKind } from "@/lib/creator/universe";

import { EmptyNote } from "./studio-ui";

/**
 * Creator Universe™ (Feature 15 · Part 9).
 *
 * Inline SVG, static layout, server-rendered. No physics loop: a force-directed
 * graph means the main thread running for as long as the page is open, which
 * this project does not spend on decoration — and a deterministic layout also
 * means a creator who opens this twice sees the same picture, which is what
 * stops it reading as an ornament.
 *
 * Every node has a row behind it. Nothing here is a placeholder.
 */

const SIZE = 400;

const KIND_CLASS: Record<UniverseNodeKind, string> = {
  self: "fill-primary",
  category: "fill-violet-500",
  sound: "fill-fuchsia-500",
  collection: "fill-cyan-500",
  surface: "fill-emerald-500",
  collaborator: "fill-amber-500",
};

const LEGEND: { kind: UniverseNodeKind; label: string }[] = [
  { kind: "category", label: "Topics" },
  { kind: "collaborator", label: "Collaborators" },
  { kind: "sound", label: "Sounds" },
  { kind: "collection", label: "Collections" },
  { kind: "surface", label: "Where views came from" },
];

export function UniverseMap({ graph }: { graph: UniverseGraph }) {
  if (graph.empty) {
    return (
      <EmptyNote>
        Your universe fills in as your work connects to things — the topics you post in, the sounds you use,
        the collections it lands in, and the surfaces that carry it. Nothing is drawn until there is a real
        connection to draw.
      </EmptyNote>
    );
  }

  const centre = graph.nodes.find((n) => n.id === "self")!;
  const centrePt = universePoint(centre, SIZE);

  return (
    <div>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="mx-auto h-auto w-full max-w-[420px]"
          role="img"
          aria-label={`A map of ${graph.nodes.length - 1} things connected to your work`}
        >
          {/* Orbit rings, faint — they make the ring structure legible without
              becoming part of the data. */}
          {[0.42, 0.62, 0.85].map((r) => (
            <circle
              key={r}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={r * (SIZE / 2) * 0.86}
              className="fill-none stroke-border"
              strokeWidth={1}
              strokeDasharray="2 5"
            />
          ))}

          {graph.links.map((l) => {
            const node = graph.nodes.find((n) => n.id === l.to);
            if (!node) return null;
            const p = universePoint(node, SIZE);
            return (
              <line
                key={l.to}
                x1={centrePt.x}
                y1={centrePt.y}
                x2={p.x}
                y2={p.y}
                className="stroke-border"
                strokeWidth={1}
                opacity={0.65}
              />
            );
          })}

          {graph.nodes.map((node) => {
            const p = universePoint(node, SIZE);
            const r = node.kind === "self" ? 17 : 4 + node.weight * 7;
            return (
              <g key={node.id}>
                <circle cx={p.x} cy={p.y} r={r} className={KIND_CLASS[node.kind]} opacity={node.kind === "self" ? 1 : 0.85}>
                  <title>{`${node.label} — ${node.value.toLocaleString()}`}</title>
                </circle>
                {node.kind !== "self" ? (
                  <text
                    x={p.x}
                    y={p.y + r + 9}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    style={{ fontSize: 8 }}
                  >
                    {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {LEGEND.filter((l) => graph.nodes.some((n) => n.kind === l.kind)).map((l) => (
          <li key={l.kind} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <svg width="8" height="8" aria-hidden>
              <circle cx="4" cy="4" r="4" className={KIND_CLASS[l.kind]} />
            </svg>
            {l.label}
          </li>
        ))}
      </ul>

      {graph.nodes.some((n) => n.href) ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {graph.nodes
            .filter((n) => n.href)
            .map((n) => (
              <Link
                key={n.id}
                href={n.href!}
                prefetch={false}
                className="rounded-xl bg-secondary px-2.5 py-1.5 text-[11px] font-semibold transition hover:bg-secondary/70"
              >
                {n.label}
              </Link>
            ))}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Dot size is a real magnitude — views for a topic, plays for a sound, posts for a collaborator. The
        layout is fixed, so this map looks the same every time you open it.
      </p>
    </div>
  );
}
