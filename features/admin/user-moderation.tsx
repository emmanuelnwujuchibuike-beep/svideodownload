"use client";

import { EyeOff, Eye, Loader2, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface AdminUser {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  is_suspended: boolean;
  created_at: string;
}

/**
 * Hide any account from everyone (owner, 2026-07-16: "make admin can hide a
 * users account from everyone for security reasons").
 *
 * Deliberately thin. The hiding mechanism already existed and is fully wired —
 * `profiles.is_suspended` removes an account from the profile page (404), the
 * home + explore feeds, discovery, engagement lists, friend activity, stories
 * and broadcasts — and `POST /api/admin/moderation` already sets it. The only
 * thing missing was REACH: the moderation queue can only act on accounts
 * somebody has already REPORTED, which is precisely the wrong constraint for a
 * security hide (an admin spotting a problem first is the whole scenario).
 *
 * So this adds search, and reuses the existing audited `moderate()` write path
 * rather than introducing a second way to set the same column. One write path,
 * one audit trail.
 */
export function UserModeration() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow early request landing after a faster later one and
  // repainting the list with stale results for a query the admin has already
  // moved on from.
  const reqSeq = useRef(0);

  const search = useCallback(async (term: string) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { users: AdminUser[] };
      if (seq === reqSeq.current) setUsers(data.users);
    } catch {
      if (seq === reqSeq.current) setError("Couldn't load accounts.");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  // Debounced: this hits the DB on every keystroke otherwise.
  useEffect(() => {
    const t = setTimeout(() => void search(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, search]);

  const toggleHidden = async (u: AdminUser) => {
    const hiding = !u.is_suspended;
    if (
      hiding &&
      !window.confirm(
        `Hide @${u.handle} from everyone?\n\nTheir profile, posts, stories and comments become invisible across the whole app, and they disappear from search and discovery. Reversible at any time.`,
      )
    ) {
      return;
    }
    setBusyId(u.id);
    try {
      const res = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "user", targetId: u.id, action: hiding ? "suspend" : "unsuspend" }),
      });
      if (!res.ok) throw new Error();
      // Patch in place rather than router.refresh(): this panel owns its own
      // data (it's client-fetched), and refresh() would additionally blow away
      // the whole client Router Cache for every other route — the exact cause
      // of "Home reloads on every entry" fixed elsewhere today.
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_suspended: hiding } : x)));
    } catch {
      setError("That change didn't save.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
      <h2 className="flex items-center gap-2 text-base font-bold">
        <ShieldCheck className="h-4 w-4 text-primary" />
        Account visibility
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Hide any account from everyone. Works without a report — for security cases you spot first.
      </p>

      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by handle or name…"
          aria-label="Search accounts"
          className="h-11 w-full rounded-xl bg-secondary/60 pl-9 pr-3 text-sm outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-primary"
        />
      </div>

      {error ? <p className="mt-3 text-sm text-rose-500">{error}</p> : null}

      <ul className="mt-3 divide-y divide-border/50">
        {loading && users.length === 0 ? (
          <li className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
          </li>
        ) : users.length === 0 ? (
          <li className="py-6 text-center text-sm text-muted-foreground">No accounts match that search.</li>
        ) : (
          users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-bold">
                {u.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  (u.display_name ?? u.handle ?? "?").charAt(0).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <Link
                  href={`/u/${u.handle}`}
                  className="block truncate text-sm font-semibold hover:underline"
                >
                  {u.display_name || `@${u.handle}`}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">
                  @{u.handle}
                  {u.is_suspended ? " · hidden from everyone" : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void toggleHidden(u)}
                disabled={busyId === u.id}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                  u.is_suspended
                    ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
                    : "bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400",
                )}
              >
                {busyId === u.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : u.is_suspended ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {u.is_suspended ? "Unhide" : "Hide"}
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
