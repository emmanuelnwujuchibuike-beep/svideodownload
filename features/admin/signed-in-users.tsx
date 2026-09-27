"use client";

import { ChevronRight, Loader2, MonitorSmartphone, ShieldAlert, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { MemberActivityItem, SignedInRoster, SignedInUser } from "@/lib/admin/people";
import { adminJson, useAdminLive } from "./live/use-admin-live";
import { useFeatureStream } from "./live/use-feature-stream";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SIGNED-IN MEMBERS, AND WHAT EACH ONE IS DOING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "Make a place in admin dashboard where I can see all
 * signed in users and detailed activities. But all shouldn't poll at once,
 * only each section should poll when I click on it and when I enter another
 * section the previous should stop polling."
 *
 * ── It polls only while it is the section on screen ─────────────────────────
 *
 * That is free here rather than something this file implements: `useAdminLive`
 * reads `useAdminPanelVisible()` and unsubscribes the moment its panel is
 * hidden, and `AdminSubsections` provides that context per sub-tab. So opening
 * another section stops this one, and nothing else starts.
 *
 * The member detail is deliberately NOT on the scheduler. It is fetched once
 * when a row is opened and again only if the operator asks — a drill-down
 * nobody is watching change does not need a request a minute.
 *
 * ── 🔴 THE LABEL IS THE HONEST ONE ──────────────────────────────────────────
 *
 * There is no session table in this database (probed: `user_sessions`,
 * `sessions`, `presence`, `user_presence` all 404), and Supabase's own
 * `auth.sessions` is not exposed. "Signed in" therefore means *seen active
 * while carrying a session*, and the header says so in as many words. A screen
 * that said "online now" would be read as presence and would be wrong for
 * everyone who closed a tab.
 */

const WINDOWS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
] as const;

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Within five minutes of their last event — as close to "here now" as this data can honestly get. */
function isLive(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60_000;
}

const FEATURE_TONE: Record<string, string> = {
  traffic: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  downloads: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  ai: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  ads: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  pwa: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  perf: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
};

export function SignedInUsers() {
  const [hours, setHours] = useState<number>(24);
  const [open, setOpen] = useState<SignedInUser | null>(null);

  const { data, error } = useAdminLive<SignedInRoster>({
    key: `admin:people:${hours}`,
    // "stats", not "live": this is a roster of who has been about, and a
    // 60-second refresh is the band the cost rules put dashboard statistics in.
    tier: "stats",
    fetcher: useCallback(() => adminJson<SignedInRoster>(`/api/admin/people?hours=${hours}`), [hours]),
    // Nothing new to show ⇒ the scheduler is allowed to stretch the interval.
    quiet: useCallback((v: SignedInRoster) => v.users.length === 0, []),
  });

  /*
    ── THE PER-SECTION REALTIME STREAM (owner, 2026-09-27) ───────────────────
    "Admin → Users should subscribe only to relevant user events … when the
    admin leaves that section, immediately unsubscribe."

    Used as a FRESHNESS SIGNAL, not as a second list. The roster is an
    aggregate — sessions counted, features tallied, profiles joined — and
    folding raw inserts into it client-side would produce a second, subtly
    different answer to the same question. So the stream only says "something
    happened since you looked", and the 60s refresh remains the one source of
    the numbers.

    It unsubscribes with the panel, because `useFeatureStream` reads the same
    visibility context `useAdminLive` does.
  */
  const { events: liveEvents, connected } = useFeatureStream("traffic", { limit: 40 });
  const [seenAt, setSeenAt] = useState<number>(() => Date.now());
  useEffect(() => {
    // Each refresh of the roster is the moment it was last accurate.
    if (data) setSeenAt(Date.now());
  }, [data]);
  const sinceRefresh = liveEvents.filter((e) => new Date(e.at).getTime() > seenAt).length;

  const users = data?.users ?? [];
  const liveNow = users.filter((u) => isLive(u.lastSeen)).length;

  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-border/70 bg-card p-6 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-5 w-5 text-primary" /> Signed-in members
        </h2>
        <div className="flex items-center gap-2">
        {connected ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {sinceRefresh > 0 ? `${sinceRefresh} new` : "Live"}
          </span>
        ) : null}
        <div className="flex gap-1 rounded-full bg-secondary/50 p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setHours(w.hours)}
              className={cn(
                "rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors",
                hours === w.hours ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/*
        🔴 The definition, on the screen rather than in a comment. This counts
        members seen ACTIVE while signed in. It is not presence: there is no
        session table to read, and a number labelled "online" would be believed.
      */}
      <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
        Members whose browser recorded activity while signed in. This is not a presence list — someone who has closed
        the app still appears until their last activity leaves the window, and a member who signed in and did nothing
        never appears at all.
      </p>

      {data?.partial ? (
        <p className="mb-4 rounded-2xl bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
          This window held more activity than one read returns, so the list below is partial. Narrow the window for a
          complete answer.
        </p>
      ) : null}

      {error && !data ? (
        <p className="rounded-2xl bg-secondary/40 px-4 py-6 text-center text-sm text-muted-foreground">
          Could not read the roster just now. It will retry.
        </p>
      ) : null}

      {!data && !error ? (
        <p className="flex items-center justify-center gap-2 rounded-2xl bg-secondary/40 px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading activity…
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Mini label="Active in window" value={formatCompactNumber(users.length)} />
            <Mini label="Active in last 5 min" value={formatCompactNumber(liveNow)} />
            <Mini label="Member accounts" value={formatCompactNumber(data.totalMembers)} />
          </div>

          {users.length === 0 ? (
            <p className="rounded-2xl bg-secondary/40 px-4 py-6 text-center text-sm text-muted-foreground">
              No signed-in activity in this window.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
              {users.map((u) => (
                <li key={u.userId}>
                  <button
                    type="button"
                    onClick={() => setOpen(u)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/40"
                  >
                    <Avatar user={u} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-semibold">
                          {u.displayName || (u.handle ? `@${u.handle}` : "Member")}
                        </span>
                        {isLive(u.lastSeen) ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="active now" />
                        ) : null}
                        {u.isAdmin ? <Tag tone="bg-primary/12 text-primary">Admin</Tag> : null}
                        {u.isSuspended ? <Tag tone="bg-red-500/12 text-red-600">Suspended</Tag> : null}
                        {u.isHidden ? <Tag tone="bg-amber-500/12 text-amber-600">Hidden</Tag> : null}
                      </div>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {ago(u.lastSeen)} · {u.events} events · {u.sessions} session{u.sessions === 1 ? "" : "s"}
                        {u.downloads > 0 ? ` · ${u.downloads} download${u.downloads === 1 ? "" : "s"}` : ""}
                        {u.lastPath ? ` · ${u.lastPath}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {u.features.slice(0, 4).map((f) => (
                          <span
                            key={f.feature}
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold",
                              FEATURE_TONE[f.feature] ?? "bg-secondary text-muted-foreground",
                            )}
                          >
                            {f.feature} {f.count}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {open ? <MemberDetail user={open} hours={hours} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function Avatar({ user }: { user: SignedInUser }) {
  const initial = (user.displayName || user.handle || "?").trim().charAt(0).toUpperCase();
  return user.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-semibold text-muted-foreground">
      {initial}
    </span>
  );
}

function Tag({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold", tone)}>{children}</span>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/25 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}

/**
 * One member's timeline.
 *
 * Fetched ONCE on open, not polled: an operator reading what somebody did an
 * hour ago is not watching it change, and this dashboard has cost the owner
 * real money on exactly that kind of assumption before.
 */
/**
 * One member, as a near-fullscreen modal.
 *
 * Owner, 2026-09-27: "Clicking on a sign in user profile in admin dashboard
 * should show a clear understandable data that are arranged and it should show
 * as a modal almost full screen not to come at the bottom of the page."
 *
 * It was an inline block appended under the list, which on a phone meant the
 * answer to "who is this?" appeared below the fold, under everything that had
 * prompted the question — so tapping a row looked like nothing had happened.
 *
 * ── What the arrangement is for ─────────────────────────────────────────────
 *
 * Three bands, in the order the questions get asked: WHO (identity and account
 * state), WHAT IN TOTAL (the counted summary), then WHAT EXACTLY (the
 * timeline). The raw event properties stay, on the same reasoning the live feed
 * was rebuilt for in August: reducing a row to one line throws away the thing
 * an operator opened it to find.
 *
 * Fetched once on open and never polled — nobody is watching an hour-old
 * timeline change, and this dashboard has cost real money on that assumption
 * before.
 */
function MemberDetail({ user, hours, onClose }: { user: SignedInUser; hours: number; onClose: () => void }) {
  const [items, setItems] = useState<MemberActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setFailed(false);
    adminJson<{ items: MemberActivityItem[] }>(`/api/admin/people?user=${user.userId}&hours=${hours}`)
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user.userId, hours]);

  /*
    Escape closes, and the page behind does not scroll while this is open. Both
    restored on unmount — a modal that leaves `overflow: hidden` behind locks
    the whole dashboard.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const windowLabel = hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-stretch justify-center bg-black/55 p-2 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Activity for ${user.displayName || user.handle || "member"}`}
      /* A tap on the backdrop closes; a tap inside must not bubble out to it. */
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-2xl"
      >
        {/* ── WHO ── */}
        <div className="flex items-start gap-3 border-b border-border/60 px-4 py-4 sm:px-6">
          <Avatar user={user} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-[16px] font-semibold">
                {user.displayName || (user.handle ? `@${user.handle}` : "Member")}
              </h3>
              {isLive(user.lastSeen) ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10.5px] font-bold text-emerald-600 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                </span>
              ) : null}
              {user.isAdmin ? <Tag tone="bg-primary/12 text-primary">Admin</Tag> : null}
              {user.isSuspended ? <Tag tone="bg-red-500/12 text-red-600">Suspended</Tag> : null}
              {user.isHidden ? <Tag tone="bg-amber-500/12 text-amber-600">Hidden</Tag> : null}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {user.handle ? `@${user.handle} · ` : ""}
              {user.userId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {user.isSuspended || user.isHidden ? (
            <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              This account is {user.isSuspended ? "suspended" : "hidden"}. Moderation actions live in the Moderation
              section — nothing here changes an account.
            </p>
          ) : null}

          {/* ── WHAT, IN TOTAL ── */}
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Last {windowLabel}
          </h4>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Events" value={formatCompactNumber(user.events)} />
            <Fact label="Sessions" value={formatCompactNumber(user.sessions)} />
            <Fact label="Page views" value={formatCompactNumber(user.pageViews)} />
            <Fact label="Downloads" value={formatCompactNumber(user.downloads)} />
          </dl>

          <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Last seen" value={ago(user.lastSeen)} />
            <Fact label="First seen in window" value={ago(user.firstSeenInWindow)} />
            <Fact label="Device" value={[user.device, user.os].filter(Boolean).join(" · ") || "—"} />
            <Fact label="Browser" value={user.browser || "—"} />
          </dl>

          <dl className="mt-2 grid grid-cols-2 gap-2">
            <Fact label="Location" value={[user.city, user.country].filter(Boolean).join(", ") || "—"} />
            <Fact label="Last page" value={user.lastPath || "—"} mono />
          </dl>

          {user.features.length > 0 ? (
            <>
              <h4 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Where they spent it
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {user.features.map((f) => (
                  <span
                    key={f.feature}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[12px] font-semibold",
                      FEATURE_TONE[f.feature] ?? "bg-secondary text-muted-foreground",
                    )}
                  >
                    {f.feature} · {f.count}
                  </span>
                ))}
              </div>
            </>
          ) : null}

          {/* ── WHAT, EXACTLY ── */}
          <h4 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Activity, newest first
          </h4>

          {failed ? (
            <p className="rounded-2xl bg-secondary/40 px-4 py-6 text-center text-[13px] text-muted-foreground">
              Could not read this member&apos;s activity.
            </p>
          ) : !items ? (
            <p className="flex items-center justify-center gap-2 rounded-2xl bg-secondary/40 px-4 py-6 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…
            </p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl bg-secondary/40 px-4 py-6 text-center text-[13px] text-muted-foreground">
              Nothing recorded in this window.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {items.map((it) => (
                <li key={it.eventId} className="rounded-xl border border-border/50 bg-secondary/20 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {it.feature ? (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                            FEATURE_TONE[it.feature] ?? "bg-secondary",
                          )}
                        >
                          {it.feature}
                        </span>
                      ) : null}
                      <span className="truncate text-[13px] font-medium">{it.label}</span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{ago(it.at)}</span>
                  </div>
                  {it.path ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{it.path}</p>
                  ) : null}
                  {it.properties ? (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-snug text-muted-foreground">
                      {JSON.stringify(it.properties, null, 1)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/** One labelled figure. `mono` for values that are paths or ids, never for counts. */
function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/25 px-3 py-2">
      <dt className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-[13.5px] font-semibold", mono && "font-mono text-[12px]")}>{value}</dd>
    </div>
  );
}
