"use client";

import { ArrowLeft, Check, ChevronRight, Loader2, Network, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import type { Relationship } from "@/lib/social/graph/context";
import type { GraphGrowth, NetworkPerson } from "@/lib/social/graph/graph-server";
import type { Permission } from "@/lib/social/graph/permissions";
import type { TrustResult, TrustSignals } from "@/lib/social/graph/trust";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Your network (Feature 19 · Part 15) — the invisible graph, made legible to the
 * one person it describes. Search it in plain words, see how Frenz reads your
 * account's trust and why, watch your network grow, and look back at how it
 * changed. Everything here is the member's own; nothing is shown to anyone else.
 */

const RELATION: Record<string, string> = { friends: "Friend", following: "You follow", followers: "Follows you", pro: "Worked together", collaborators: "Collaborator", community: "Community", subscribers: "Subscriber", trusted: "Trusted", known: "" };
const EXAMPLES = ["Friends from university", "Business partners in Lagos", "Photography creators I know", "People from my community", "Trusted mentors"];
const ACTIONS: [string, string][] = [
  ["message", "Message"],
  ["follow", "Follow"],
  ["mention", "Mention them"],
  ["view_friends", "See their friends"],
  ["add_to_memory", "Add to a memory"],
  ["invite_collaborator", "Invite to collaborate"],
  ["view_sub_posts", "See their PRIVATE POSTS"],
];

export function GraphPage({ trust, growth }: { trust: (TrustResult & { signals: TrustSignals }) | null; growth: GraphGrowth }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ understood: string; results: NetworkPerson[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [person, setPerson] = useState<NetworkPerson | null>(null);
  const search = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    haptic("selection");
    setQ(t);
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/graph?view=search&q=${encodeURIComponent(t)}`).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { understood: string; results: NetworkPerson[]; error?: string } | null;
    setBusy(false);
    if (!r?.ok || !j) return setErr(j?.error ?? "Couldn't search right now.");
    setRes(j);
  };
  const max = Math.max(1, ...growth.months.map((m) => m.friends + m.followers + m.pro));
  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href="/friends" prefetch={false} aria-label="Back" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Your network</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Ask it anything. Only you see this page.</p>
        </div>
      </header>

      <form
        role="search"
        className={cn("flex items-center gap-2 rounded-2xl px-3", GLASS)}
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input aria-label="Search your network" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business partners in Lagos" className="min-h-[2.75rem] min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
        {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" onClick={() => void search(e)} className="min-h-[2.25rem] rounded-full bg-black/[0.05] px-3 text-[12.5px] font-semibold transition active:scale-95 dark:bg-white/[0.08]">
            {e}
          </button>
        ))}
      </div>
      {err ? <p className="mt-2 text-[13px] font-medium text-rose-600">{err}</p> : null}
      {res ? (
        <section className="mt-4" aria-live="polite">
          <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">
            {res.results.length} {res.results.length === 1 ? "person" : "people"} · {res.understood}
          </p>
          {res.results.length ? (
            <GlassGroup label="Results">
              {res.results.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setPerson(p)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-black/[0.04]">
                    <PersonAvatar user={{ displayName: p.name, avatarUrl: p.avatarUrl }} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold">{p.name}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">{[...p.relations.map((r) => RELATION[r]).filter(Boolean), ...p.roles.map((r) => r.replace(/_/g, " "))].join(" · ")}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </GlassGroup>
          ) : (
            <p className={cn("rounded-[20px] px-4 py-4 text-center text-[13.5px] text-muted-foreground", GLASS)}>Nobody in your network matches that yet.</p>
          )}
        </section>
      ) : null}

      {trust ? (
        <section className="mt-6" aria-labelledby="g-trust">
          <SectionHeader id="g-trust" title="How Frenz reads your account" />
          <div className={cn("rounded-[22px] px-4 py-3.5", GLASS)}>
            <p className="flex items-center gap-2 text-[16px] font-bold">
              <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden /> {trust.label}
            </p>
            <ul className="mt-2 space-y-1">
              {trust.reasons.map((r) => (
                <li key={r.text} className="flex items-start gap-2 text-[13.5px]">
                  {r.good ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />}
                  {r.text}
                </li>
              ))}
            </ul>
            {trust.next.length ? <p className="mt-2 text-[12.5px] text-muted-foreground">To build trust: {trust.next.join(" · ")}.</p> : null}
            <p className="mt-2 text-[11.5px] text-muted-foreground">Followers and likes never count. Only reports a moderator upheld do. Nobody else sees this.</p>
          </div>
        </section>
      ) : null}

      <section className="mt-6" aria-labelledby="g-growth">
        <SectionHeader id="g-growth" title="Your network, 12 months" />
        <div className={cn("rounded-[22px] px-4 py-3.5", GLASS)}>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {(
              [
                ["Friends", growth.totals.friends],
                ["Following", growth.totals.following],
                ["Followers", growth.totals.followers],
                ["Work", growth.totals.pro],
              ] as const
            ).map(([l, v]) => (
              <div key={l}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{l}</dt>
                <dd className="text-[17px] font-extrabold tabular-nums">{v.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex h-24 items-end gap-1.5" role="img" aria-label={`New connections per month: ${growth.months.map((m) => `${m.month} ${m.friends + m.followers + m.pro}`).join(", ")}`}>
            {growth.months.map((m) => {
              const n = m.friends + m.followers + m.pro;
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-violet-400" style={{ height: `${Math.max(2, (n / max) * 72)}px` }} />
                  <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">New friends, followers and work connections each month.</p>
        </div>
      </section>

      <History />

      {person ? <PersonSheet person={person} onClose={() => setPerson(null)} /> : null}
    </div>
  );
}

export function History() {
  const [items, setItems] = useState<{ id: number; text: string; person: { name: string; handle: string; avatarUrl: string | null } | null; at: string; detail: string | null }[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const load = async (before: string | null) => {
    const r = await fetch(`/api/graph?view=history${before ? `&before=${encodeURIComponent(before)}` : ""}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r) return setItems((x) => x ?? []);
    setItems((x) => [...(before ? (x ?? []) : []), ...r.items]);
    setNext(r.next);
  };
  useEffect(() => {
    void load(null);
  }, []);
  return (
    <section className="mb-8 mt-6" aria-labelledby="g-hist">
      <SectionHeader id="g-hist" title="How your network changed" />
      {!items ? (
        <div className="h-20 animate-pulse rounded-[22px] bg-black/[0.04] motion-reduce:animate-none" aria-busy="true" />
      ) : items.length ? (
        <>
          <GlassGroup label="Network history">
            {items.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3.5 py-2.5">
                {h.person ? <PersonAvatar user={{ displayName: h.person.name, avatarUrl: h.person.avatarUrl }} size={36} /> : <Network className="h-5 w-5 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px]">
                    {h.text} <b>{h.person?.name ?? h.detail ?? "a deleted account"}</b>
                  </span>
                  <span className="block text-[12px] text-muted-foreground" suppressHydrationWarning>
                    {new Date(h.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </span>
              </li>
            ))}
          </GlassGroup>
          {next ? (
            <button type="button" onClick={() => void load(next)} className={cn(quietPill, "mt-2 w-full justify-center")}>
              Show earlier
            </button>
          ) : null}
        </>
      ) : (
        <p className={cn("rounded-[20px] px-4 py-4 text-center text-[13px] text-muted-foreground", GLASS)}>Changes to your network from now on appear here, only for you.</p>
      )}
    </section>
  );
}

function PersonSheet({ person, onClose }: { person: NetworkPerson; onClose: () => void }) {
  const [rel, setRel] = useState<Relationship | null>(null);
  const [perms, setPerms] = useState<Record<string, Permission>>({});
  useEffect(() => {
    let live = true;
    void fetch(`/api/graph?view=context&id=${person.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setRel(j));
    for (const [a] of ACTIONS)
      void fetch(`/api/graph?view=can&action=${a}&id=${person.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setPerms((p) => ({ ...p, [a]: j })));
    return () => {
      live = false;
    };
  }, [person.id]);
  return (
    <GlassSheetShell open onClose={onClose} title={person.name} defaultHeightVh={80} fitContent>
      <div className="space-y-4 px-4 pb-6">
        <div className="flex items-center gap-3">
          <PersonAvatar user={{ displayName: person.name, avatarUrl: person.avatarUrl }} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold">{person.name}</p>
            <p className="truncate text-[13px] text-muted-foreground">@{person.handle}</p>
          </div>
          <Link href={`${profilePath(person.handle)}`} prefetch={false} className={primaryPill}>
            Profile
          </Link>
        </div>
        <section aria-labelledby="ps-ctx">
          <h3 id="ps-ctx" className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            How you&apos;re connected
          </h3>
          {!rel ? (
            <div className="mt-2 h-14 animate-pulse rounded-2xl bg-black/[0.04] motion-reduce:animate-none" />
          ) : rel.contexts.length ? (
            <ul className="mt-2 space-y-1.5">
              {rel.contexts.map((c) => (
                <li key={`${c.edge}-${c.label}`} className="flex items-baseline gap-2 text-[14px]">
                  <span className="font-semibold">{c.label}</span>
                  {c.detail ? <span className="text-muted-foreground">· {c.detail}</span> : null}
                  {c.since ? (
                    <span className="ml-auto shrink-0 text-[12px] text-muted-foreground" suppressHydrationWarning>
                      since {new Date(c.since).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground">No connection yet.</p>
          )}
        </section>
        <section aria-labelledby="ps-can">
          <h3 id="ps-can" className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">
            What you can do
          </h3>
          <ul className="mt-2 space-y-1.5">
            {ACTIONS.map(([a, label]) => {
              const p = perms[a];
              return (
                <li key={a} className="flex items-start gap-2 text-[13.5px]">
                  {!p ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : p.allowed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span>
                    <span className="font-semibold">{label}</span>
                    {p ? <span className="text-muted-foreground"> · {p.reason}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </GlassSheetShell>
  );
}
