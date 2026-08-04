"use client";

import { Check, Loader2, Plus, Trash2, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import type { FriendProfile } from "@/lib/social/friends";
import {
  CIRCLE_COLORS,
  circleColorClasses,
  MAX_CIRCLES_PER_MEMBER,
  SUGGESTED_CIRCLES,
  validateCircleName,
  type CircleColor,
} from "@/lib/social/graph/circles";
import type { GraphConnection } from "@/lib/social/graph/overview";
import type { CircleRow } from "@/lib/social/graph/store";
import { cn } from "@/lib/utils";

/**
 * Social Circles™ — create circles and put people in them (Part 17).
 *
 * ── The interaction is a checklist, not drag-and-drop ─────────────────────
 * Same call as the modules editor: a drag handle needs a parallel keyboard
 * interface to be usable at all, and it is unreliable on touch inside a
 * scrolling list — which is exactly where this lives. Tapping a name to tick
 * it works identically with a mouse, a finger, a keyboard and a screen reader.
 *
 * ── Optimistic, but honest about failure ──────────────────────────────────
 * Ticking someone applies immediately and reverts if the write fails, with the
 * server's reason shown. A membership control that silently no-ops is worse
 * than a slow one: the member believes their private section is gated to
 * Family when it is gated to nobody.
 */

interface Props {
  circles: CircleRow[];
  connections: GraphConnection[];
  /** memberId → circleIds, seeded from the server. */
  initialMembership: Record<string, string[]>;
}

export function CirclesManager({ circles: initialCircles, connections, initialMembership }: Props) {
  const [circles, setCircles] = useState(initialCircles);
  const [membership, setMembership] = useState<Record<string, string[]>>(initialMembership);
  const [activeId, setActiveId] = useState<string | null>(initialCircles[0]?.id ?? null);
  const [creating, setCreating] = useState(initialCircles.length === 0);
  const [name, setName] = useState("");
  const [color, setColor] = useState<CircleColor>("blue");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const active = circles.find((c) => c.id === activeId) ?? null;

  const create = useCallback(
    async (rawName: string, rawColor: CircleColor) => {
      const check = validateCircleName(
        rawName,
        circles.map((c) => c.name),
      );
      if (!check.ok) {
        setError(check.error);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/graph/circles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: check.value, color: rawColor }),
        });
        const json = (await res.json()) as { circle?: CircleRow; error?: string };
        if (!res.ok || !json.circle) {
          setError(json.error ?? "Couldn't create that circle.");
          return;
        }
        setCircles((cs) => [...cs, json.circle!]);
        setActiveId(json.circle.id);
        setCreating(false);
        setName("");
      } catch {
        setError("Network error.");
      } finally {
        setBusy(false);
      }
    },
    [circles],
  );

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/graph/circles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Couldn't delete that circle.");
        return;
      }
      setCircles((cs) => cs.filter((c) => c.id !== id));
      setMembership((m) => {
        const next: Record<string, string[]> = {};
        for (const [memberId, ids] of Object.entries(m)) next[memberId] = ids.filter((cid) => cid !== id);
        return next;
      });
      setActiveId((cur) => (cur === id ? null : cur));
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleMember = useCallback(
    async (memberId: string) => {
      if (!activeId) return;
      const inCircle = (membership[memberId] ?? []).includes(activeId);

      // Optimistic.
      setMembership((m) => {
        const ids = m[memberId] ?? [];
        return { ...m, [memberId]: inCircle ? ids.filter((id) => id !== activeId) : [...ids, activeId] };
      });
      setCircles((cs) =>
        cs.map((c) => (c.id === activeId ? { ...c, memberCount: c.memberCount + (inCircle ? -1 : 1) } : c)),
      );
      setPending((p) => new Set(p).add(memberId));
      setError(null);

      try {
        const res = inCircle
          ? await fetch(`/api/graph/circles/${activeId}/members?memberId=${memberId}`, { method: "DELETE" })
          : await fetch(`/api/graph/circles/${activeId}/members`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ memberId }),
            });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error ?? "Couldn't update that circle.");
        }
      } catch (e) {
        // Revert — a membership control must never lie about what it saved.
        setMembership((m) => {
          const ids = m[memberId] ?? [];
          return { ...m, [memberId]: inCircle ? [...ids, activeId] : ids.filter((id) => id !== activeId) };
        });
        setCircles((cs) =>
          cs.map((c) => (c.id === activeId ? { ...c, memberCount: c.memberCount + (inCircle ? 1 : -1) } : c)),
        );
        setError(e instanceof Error ? e.message : "Couldn't update that circle.");
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(memberId);
          return next;
        });
      }
    },
    [activeId, membership],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter(
      (c) => c.user.displayName.toLowerCase().includes(q) || c.user.handle.toLowerCase().includes(q),
    );
  }, [connections, query]);

  const unusedSuggestions = SUGGESTED_CIRCLES.filter(
    (s) => !circles.some((c) => c.name.toLowerCase() === s.name.toLowerCase()),
  ).slice(0, 6);

  return (
    <div className="space-y-5">
      {/* ── Circle rail ───────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center gap-1.5">
          {circles.map((c) => {
            const cls = circleColorClasses(c.color);
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition",
                  isActive ? `${cls.chip} ${cls.ring}` : "bg-secondary/50 text-muted-foreground ring-transparent hover:text-foreground",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", cls.dot)} />
                {c.name}
                <span className="tabular-nums opacity-60">{c.memberCount}</span>
              </button>
            );
          })}
          {circles.length < MAX_CIRCLES_PER_MEMBER ? (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New circle
            </button>
          ) : null}
        </div>

        {creating ? (
          <div className="mt-3 rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm">
            <label htmlFor="circle-name" className="text-xs font-semibold">
              Circle name
            </label>
            <input
              id="circle-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="Family"
              className="mt-1.5 w-full rounded-xl bg-background px-3 py-2 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {CIRCLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`${c} colour`}
                  aria-pressed={color === c}
                  className={cn(
                    "h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                    circleColorClasses(c).dot,
                    color === c ? "ring-foreground/40" : "ring-transparent",
                  )}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => void create(name, color)}
                className="btn-lux btn-lux-primary !py-2 !text-xs"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Create
              </button>
              {circles.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="px-2 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                >
                  Cancel
                </button>
              ) : null}
            </div>

            {unusedSuggestions.length > 0 ? (
              <div className="mt-3 border-t border-border/60 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Or start from
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unusedSuggestions.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      disabled={busy}
                      onClick={() => void create(s.name, s.color)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", circleColorClasses(s.color).dot)} />
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="mt-2 text-xs font-medium text-rose-500">{error}</p> : null}
      </section>

      {/* ── Members ───────────────────────────────────────────────── */}
      {active ? (
        <section>
          <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
            <h2 className="text-sm font-bold">
              Who&apos;s in {active.name}
              <span className="ml-1.5 font-medium text-muted-foreground">{active.memberCount}</span>
            </h2>
            <button
              type="button"
              onClick={() => void remove(active.id)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete circle
            </button>
          </div>

          {connections.length > 8 ? (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your friends"
              aria-label="Search your friends"
              className="mb-2 w-full rounded-xl bg-card px-3 py-2 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
          ) : null}

          {connections.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
              Circles hold people you&apos;re connected to.{" "}
              <Link href="/friends" prefetch className="font-semibold text-primary hover:underline">
                Add some friends
              </Link>{" "}
              first.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
              {filtered.map((c) => {
                const inCircle = (membership[c.user.id] ?? []).includes(active.id);
                const saving = pending.has(c.user.id);
                return (
                  <li key={c.user.id} className="border-b border-border/60 last:border-0">
                    <button
                      type="button"
                      onClick={() => void toggleMember(c.user.id)}
                      aria-pressed={inCircle}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-secondary/40"
                    >
                      <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-secondary">
                        {c.user.avatarUrl ? (
                          <Image src={c.user.avatarUrl} alt="" fill sizes="36px" className="object-cover" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{c.user.displayName}</span>
                        <span className="block truncate text-xs text-muted-foreground">@{c.user.handle}</span>
                      </span>
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition",
                          inCircle ? "bg-primary text-white" : "bg-secondary text-transparent ring-1 ring-inset ring-border",
                        )}
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 ? (
                <li className="px-3.5 py-6 text-center text-sm text-muted-foreground">Nobody matches that.</li>
              ) : null}
            </ul>
          )}
        </section>
      ) : circles.length > 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          <Users className="mx-auto mb-2 h-5 w-5" />
          Pick a circle to manage who&apos;s in it.
        </p>
      ) : null}

      {/* The honest note about what a circle currently does. */}
      <p className="rounded-2xl bg-secondary/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        Circles are private — nobody is told they&apos;re in one. Today you can show a{" "}
        <Link href="/account/modules" prefetch className="font-semibold text-primary hover:underline">
          profile section
        </Link>{" "}
        to one circle only, and filter your friends by circle. Posting and messaging to a circle aren&apos;t built yet.
      </p>
    </div>
  );
}
