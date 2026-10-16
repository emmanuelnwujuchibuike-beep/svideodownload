"use client";

import { ArrowLeft, ArrowRight, Download, Lightbulb, Lock, Plus, Search, Trash2, Wallet, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { AmbientWash, GLASS, GlassGroup, PersonAvatar, primaryPill, quietPill, SectionHeader } from "@/features/friends/ui";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { haptic } from "@/lib/motion/haptics";
import { FEEDBACK_ASPECTS, MEMBER_ROLES, RECOGNITIONS, SPONSOR_KINDS, usd, type MemberRole, type Recognition, type SponsorKind } from "@/lib/creator/membership/engine";
import type { CreatorDashboard as Dashboard, Membership, Person } from "@/lib/creator/membership/server";
import { cn } from "@/lib/utils";

const SubscribersList = dynamic(() => import("@/features/members/subscribers-list").then((m) => m.SubscribersList), { ssr: false });
const SubPayoutSettings = dynamic(() => import("@/features/sub/payout-settings").then((m) => m.SubPayoutSettings), { ssr: false });
const SubWithdrawSheet = dynamic(() => import("@/features/sub/sub-withdraw").then((m) => m.SubWithdrawSheet), { ssr: false });

/**
 * Members (Feature 19 · Part 13) — the creator's community, and the memberships
 * the viewer holds. A membership is free (the community) or a paid SUB
 * subscription (0227): SUB is real money through Paystack, set up and posted to
 * from the SUB POSTS tab on the creator's profile, and paid out from here.
 *
 * Communities before numbers: the dashboard leads with people and what they
 * do, never with a ranking by money. Fan Insights are aggregates with a floor
 * (a group of fewer than five shows as "Other"), and member ratings appear only
 * as averages once five members have answered. Every toggle answers on the tap.
 */

async function post(body: Record<string, unknown>): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  const res = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
  if (res?.ok) return { error: null, data };
  return { error: (data?.error as string | undefined) ?? (res ? "Couldn't save that." : "You're offline."), data: null };
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const FIELD = "min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function CreatorDashboard({ initial, held, handle }: { initial: Dashboard; held: { membership: Membership; creator: Person }[]; handle: string }) {
  const [tab, setTab] = useState<"community" | "mine">(held.length && !initial.members.length && !initial.settings.setupCompleted ? "mine" : "community");
  const [d, setD] = useStickyState("mb-dashboard", initial.loadedAt, initial);
  const dRef = useRef(d);
  dRef.current = d;
  const [note, setNote] = useState<string | null>(initial.ready ? null : "Memberships arrive with the next update.");

  /** Draw it, send it, put it back on refusal. */
  const act = async (draw: (x: Dashboard) => Dashboard, body: Record<string, unknown>) => {
    const before = dRef.current;
    haptic("selection");
    setD(draw(before));
    setNote(null);
    const out = await post(body);
    if (out.error) {
      setD(before);
      setNote(out.error);
    }
    return out;
  };

  return (
    <div className="relative isolate">
      <AmbientWash />
      <header className="mb-4 flex items-start gap-2 pt-1">
        <Link href="/friends" aria-label="Back" className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition hover:bg-black/[0.04] active:bg-black/[0.08]">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-[clamp(1.6rem,7vw,2rem)] font-extrabold leading-none tracking-[-0.04em]">Members</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Your community, and the memberships you hold.</p>
        </div>
      </header>

      <div role="tablist" aria-label="Members" className={cn("mb-5 inline-flex rounded-full p-1", GLASS)}>
        {(
          [
            ["community", "Your community"],
            ["mine", `Your memberships${held.length ? ` (${held.length})` : ""}`],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("min-h-[2.5rem] rounded-full px-4 text-[13.5px] font-semibold transition active:scale-[0.97] motion-reduce:active:scale-100", tab === k ? "bg-foreground text-background" : "text-foreground/70")}>
            {l}
          </button>
        ))}
      </div>

      <div aria-live="polite">{note ? <p className={cn("mb-4 rounded-2xl px-3.5 py-2.5 text-[13px]", GLASS)}>{note}</p> : null}</div>

      {tab === "mine" ? (
        <Held held={held} />
      ) : (
        <>
          <Setup d={d} handle={handle} act={act} />
          <Insights d={d} />
          <Assistant d={d} />
          <Directory d={d} act={act} />
          <Notes d={d} setD={setD} act={act} setNote={setNote} />
          <Sponsors d={d} setD={setD} act={act} setNote={setNote} />
          <section className="mb-8">
            <a href="/api/members/export" download className={cn(quietPill, "w-full justify-center")}>
              <Download className="h-4 w-4" aria-hidden /> Export members (CSV)
            </a>
          </section>
        </>
      )}
    </div>
  );
}

type Act = (draw: (x: Dashboard) => Dashboard, body: Record<string, unknown>) => Promise<{ error: string | null; data: Record<string, unknown> | null }>;

function Held({ held }: { held: { membership: Membership; creator: Person }[] }) {
  // Part 5: paid subscriptions are managed (cancel, renew, receipts) on one page
  const manage = (
    <Link href="/account/subscriptions" prefetch={false} className={cn(quietPill, "mb-3 w-full justify-center")}>
      Manage subscriptions and receipts <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
  if (!held.length)
    return (
      <>
        <p className={cn("mb-3 rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>You haven&apos;t joined any memberships. Creators who offer one show it on their profile.</p>
        {manage}
      </>
    );
  return (
    <>
    {held.some((h) => h.membership.billing === "sub") ? manage : null}
    <GlassGroup label="Your memberships">
      {held.map(({ membership: m, creator }) => (
        <li key={m.id}>
          <Link href={m.billing === "sub" ? `/u/${creator.handle}?tab=sub` : `/u/${creator.handle}/membership`} prefetch={false} className="flex items-center gap-3 px-3.5 py-3 transition active:bg-black/[0.04]">
            <PersonAvatar user={creator} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-semibold">{creator.displayName}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                {[m.billing === "sub" ? "Subscriber" : MEMBER_ROLES[m.role], m.current ? (m.periodEnd ? `access until ${fmt(m.periodEnd)}` : "Free") : m.billing === "sub" ? "subscription ended" : "ended"].join(" · ")}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </GlassGroup>
    </>
  );
}

function Setup({ d, handle, act }: { d: Dashboard; handle: string; act: Act }) {
  const [welcome, setWelcome] = useState(d.settings.welcome ?? "");
  const [withdrawing, setWithdrawing] = useState(false);
  const st = d.settings;
  return (
    <section className="mb-6" aria-labelledby="mb-setup">
      <SectionHeader
        id="mb-setup"
        title="Your membership"
        action={
          <Link href={`/u/${handle}/membership`} prefetch={false} className="text-[13px] font-semibold text-primary">
            View page
          </Link>
        }
      />
      {/* paid: SUB — real money through Paystack, separate from AI credits */}
      <div className={cn("mb-2 rounded-[22px] px-3.5 py-3", GLASS)}>
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white">
            <Lock className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">Paid subscription (private posts)</span>
            <span className="block text-[12.5px] text-muted-foreground">
              {st.setupCompleted && st.priceCents
                ? `${usd(st.priceCents)} a month · ${st.active ? "live" : "paused"} · ${d.insights.subscribers.toLocaleString()} subscriber${d.insights.subscribers === 1 ? "" : "s"}`
                : "Not set up. Subscribers pay you through Paystack for your PRIVATE POSTS."}
            </span>
          </span>
        </div>
        {st.setupCompleted ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["Available", usd(d.earnings.availableCents)],
                ["Clearing", usd(d.earnings.pendingCents)],
                ["Lifetime", usd(d.earnings.lifetimeCents)],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="rounded-2xl bg-black/[0.03] px-2 py-2 dark:bg-white/[0.05]">
                <span className="block text-[16px] font-extrabold tabular-nums">{v}</span>
                <span className="block text-[11.5px] font-medium text-muted-foreground">{l}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/u/${handle}?tab=sub`} prefetch={false} className={primaryPill}>
            {st.setupCompleted ? "Open PRIVATE POSTS" : "Get paid for your content"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          {st.setupCompleted ? (
            <button type="button" onClick={() => setWithdrawing(true)} className={quietPill}>
              <Wallet className="h-4 w-4" aria-hidden /> Withdraw
            </button>
          ) : null}
        </div>
        {st.setupCompleted ? <SubPayoutSettings className="mt-3" /> : null}
      </div>
      {/* free: the community membership */}
      <div className={cn("space-y-3 rounded-[22px] px-3.5 py-3", GLASS)}>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">Free community membership</span>
            <span className="block text-[12.5px] text-muted-foreground">{st.open ? "People can join for free from your membership page." : "Closed. Existing members keep their membership."}</span>
          </span>
          <button type="button" role="switch" aria-checked={st.open} aria-label="Free community membership" disabled={!d.ready} onClick={() => void act((x) => ({ ...x, settings: { ...x.settings, open: !x.settings.open } }), { op: "settings", open: !st.open })} className={cn("relative h-6 w-11 shrink-0 touch-manipulation rounded-full transition", st.open ? "bg-primary" : "bg-muted")}>
            <span aria-hidden className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", st.open ? "left-[1.375rem]" : "left-0.5")} />
          </button>
        </div>
        <form
          className="border-t border-black/[0.06] pt-3 dark:border-white/[0.07]"
          onSubmit={(e) => {
            e.preventDefault();
            void act((x) => ({ ...x, settings: { ...x.settings, welcome: welcome.trim() || null } }), { op: "settings", welcome: welcome.trim() || null });
          }}
        >
          <label htmlFor="mb-welcome" className="text-[12.5px] text-muted-foreground">
            Welcome message on your membership page
          </label>
          <textarea id="mb-welcome" rows={2} maxLength={400} value={welcome} onChange={(e) => setWelcome(e.target.value)} className={cn(FIELD, "mt-1 resize-none py-2")} disabled={!d.ready} />
          <button type="submit" className={cn(quietPill, "mt-2")} disabled={!d.ready || welcome.trim() === (st.welcome ?? "")}>
            Save
          </button>
        </form>
      </div>
      {withdrawing ? <SubWithdrawSheet onClose={() => setWithdrawing(false)} /> : null}
    </section>
  );
}

function Insights({ d }: { d: Dashboard }) {
  const i = d.insights;
  const max = Math.max(1, ...i.joins.map((j) => j.count));
  return (
    <section className="mb-6" aria-labelledby="mb-insights">
      <SectionHeader id="mb-insights" title="Your community" />
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Members", i.active.toLocaleString()],
            ["Subscribers", i.subscribers.toLocaleString()],
            ["Kept 30 days", i.retention30 ? `${i.retention30.kept}/${i.retention30.of}` : "—"],
          ] as const
        ).map(([l, v]) => (
          <div key={l} className={cn("rounded-2xl px-3 py-2.5", GLASS)}>
            <span className="block text-[20px] font-extrabold tabular-nums leading-tight">{v}</span>
            <span className="block truncate text-[12px] font-medium text-muted-foreground">{l}</span>
          </div>
        ))}
      </div>
      <div className={cn("mt-2 rounded-[22px] px-3.5 py-3", GLASS)}>
        <p className="text-[12.5px] font-semibold text-muted-foreground">New members by month</p>
        <div className="mt-2 flex h-20 items-end gap-2" role="img" aria-label={i.joins.map((j) => `${j.month}: ${j.count}`).join(", ")}>
          {i.joins.map((j) => (
            <div key={j.month} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] tabular-nums text-muted-foreground">{j.count}</span>
              <span className="w-full rounded-md bg-primary/70" style={{ height: `${Math.max(3, (j.count / max) * 52)}px` }} />
              <span className="text-[10.5px] text-muted-foreground">{j.month.slice(5)}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Private posts earned all time: {usd(d.earnings.lifetimeCents)}{i.retention90 ? ` · kept ${i.retention90.kept} of ${i.retention90.of} past 90 days` : ""}.
        </p>
        {i.countries.length || i.languages.length ? (
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {i.countries.length ? `Where: ${i.countries.map((c) => `${c.label} (${c.count})`).join(", ")}. ` : ""}
            {i.languages.length ? `Languages: ${i.languages.map((c) => `${c.label} (${c.count})`).join(", ")}.` : ""}
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] text-muted-foreground">Places and languages appear once five or more members share one, so nobody can be picked out.</p>
        )}
        {d.feedback?.length ? (
          <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-black/[0.06] pt-2.5 text-[12.5px] dark:border-white/[0.07]">
            {d.feedback.map((f) => (
              <li key={f.aspect} className="flex justify-between gap-2">
                <span>{FEEDBACK_ASPECTS[f.aspect]}</span>
                <span className="font-semibold tabular-nums">{f.average.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Assistant({ d }: { d: Dashboard }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const items = d.assistant.filter((s) => !dismissed.includes(s.id));
  if (!items.length) return null;
  const name = (id: string) => d.members.find((m) => m.person.id === id)?.person.displayName ?? "";
  return (
    <section className="mb-6" aria-labelledby="mb-assist">
      <SectionHeader id="mb-assist" title="Ideas for your community" />
      <GlassGroup label="Ideas">
        {items.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-3.5 py-3">
            <Lightbulb className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-500" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug">{s.title}</p>
              <p className="text-[12.5px] text-muted-foreground">{s.line}</p>
              {s.memberIds?.length ? <p className="mt-1 truncate text-[12.5px]">{s.memberIds.map(name).filter(Boolean).join(", ")}</p> : null}
            </div>
            <button type="button" aria-label="Not now" onClick={() => setDismissed((x) => [...x, s.id])} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:bg-black/[0.06]">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </GlassGroup>
    </section>
  );
}

function Directory({ d, act }: { d: Dashboard; act: Act }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<MemberRole | "">("");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^@/, "");
    return d.members.filter((m) => (status === "all" || m.membership.status === "active") && (!role || m.membership.role === role) && (!t || [m.person.displayName, m.person.handle, m.country ?? "", ...m.languages].some((s) => s.toLowerCase().includes(t))));
  }, [d.members, q, role, status]);
  const setMember = (memberId: string, patch: Partial<Membership>) => (x: Dashboard) => ({ ...x, members: x.members.map((m) => (m.person.id === memberId ? { ...m, membership: { ...m.membership, ...patch } } : m)) });
  // Part 5: paid subscribers are a server-paged view of this same directory, not a second list
  const [view, setView] = useState<"community" | "subscribers">("community");
  const switcher = d.settings.setupCompleted ? (
    <div role="tablist" aria-label="Directory" className={cn("mb-2 inline-flex rounded-full p-1", GLASS)}>
      {(
        [
          ["community", "Everyone"],
          ["subscribers", "Paid subscribers"],
        ] as const
      ).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={cn("min-h-[2.25rem] rounded-full px-3.5 text-[12.5px] font-semibold transition", view === k ? "bg-foreground text-background" : "text-foreground/70")}>
          {l}
        </button>
      ))}
    </div>
  ) : null;
  if (view === "subscribers")
    return (
      <section className="mb-6" aria-labelledby="mb-dir">
        <SectionHeader id="mb-dir" title="Members" />
        {switcher}
        <SubscribersList />
      </section>
    );
  return (
    <section className="mb-6" aria-labelledby="mb-dir">
      <SectionHeader id="mb-dir" title="Members" count={list.length} />
      {switcher}
      <div className={cn("mb-2 flex items-center gap-2 rounded-2xl px-3", GLASS)}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input aria-label="Search members" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, handle, country, language" className="min-h-[2.75rem] min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole | "")} className="min-h-[2.25rem] rounded-full border border-border bg-background px-3 text-[13px]">
          <option value="">Every role</option>
          {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((r) => (
            <option key={r} value={r}>
              {MEMBER_ROLES[r]}
            </option>
          ))}
        </select>
        <button type="button" aria-pressed={status === "all"} onClick={() => setStatus(status === "all" ? "active" : "all")} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", status === "all" && "bg-primary/10 text-primary")}>
          Include past members
        </button>
      </div>
      {list.length ? (
        <GlassGroup label="Members">
          {list.slice(0, 100).map((m) => {
            const expanded = open === m.person.id;
            return (
              <li key={m.membership.id}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : m.person.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-black/[0.04]">
                  <PersonAvatar user={m.person} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">{m.person.displayName}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">{[MEMBER_ROLES[m.membership.role], m.membership.billing === "sub" ? "Subscriber" : null, m.membership.status !== "active" ? m.membership.status : null, ...m.loyalty.slice(0, 1)].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
                {expanded ? (
                  <div className="space-y-3 border-t border-black/[0.06] px-3.5 py-3 dark:border-white/[0.07]">
                    {m.loyalty.length ? <p className="text-[12.5px] text-muted-foreground">{m.loyalty.join(" · ")}</p> : null}
                    <p className="text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                      Joined {fmt(m.membership.joinedAt)}
                      {m.country ? ` · ${m.country}` : ""}
                    </p>
                    <label className="block text-[12.5px] text-muted-foreground">
                      Role
                      <select value={m.membership.role} onChange={(e) => void act(setMember(m.person.id, { role: e.target.value as MemberRole }), { op: "role", memberId: m.person.id, role: e.target.value })} className={cn(FIELD, "mt-1")}>
                        {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((r) => (
                          <option key={r} value={r}>
                            {MEMBER_ROLES[r]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <p className="text-[12.5px] text-muted-foreground">Recognition (private unless you show it)</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {(Object.keys(RECOGNITIONS) as Recognition[]).map((r) => {
                          const on = m.recognitions.includes(r);
                          return (
                            <button key={r} type="button" aria-pressed={on} onClick={() => void act((x) => ({ ...x, members: x.members.map((y) => (y.person.id === m.person.id ? { ...y, recognitions: on ? y.recognitions.filter((k) => k !== r) : [...y.recognitions, r] } : y)) }), { op: "recognition", memberId: m.person.id, kind: r, on: !on, shown: r === "super_supporter" })} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]", on && "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>
                              {RECOGNITIONS[r]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/messages/new/${m.person.id}`} prefetch={false} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px]")}>
                        Message
                      </Link>
                      {m.membership.status === "active" ? (
                        <button type="button" onClick={() => void act(setMember(m.person.id, { status: "removed" }), { op: "remove", memberId: m.person.id })} className={cn(quietPill, "min-h-[2.25rem] px-3 text-[12.5px] text-rose-600")}>
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </GlassGroup>
      ) : (
        <p className={cn("rounded-[22px] px-3.5 py-3 text-[13px] text-muted-foreground", GLASS)}>{d.members.length ? "Nobody matches." : "No members yet. Open your membership and share your page."}</p>
      )}
    </section>
  );
}

function Notes({ d, setD, act, setNote }: { d: Dashboard; setD: (fn: (x: Dashboard) => Dashboard) => void; act: Act; setNote: (s: string | null) => void }) {
  const [body, setBody] = useState("");
  const [minRole, setMinRole] = useState<MemberRole>("member");
  const [sending, setSending] = useState(false);
  return (
    <section className="mb-6" aria-labelledby="mb-notes">
      <SectionHeader id="mb-notes" title="Notes for members" />
      <form
        className={cn("mb-2 space-y-2 rounded-[22px] px-3.5 py-3", GLASS)}
        onSubmit={async (e) => {
          e.preventDefault();
          haptic("selection");
          setSending(true);
          const out = await post({ op: "note", body, minRole });
          setSending(false);
          if (out.error) return setNote(out.error);
          setD((x) => ({ ...x, notes: [{ id: out.data?.id as string, body: body.trim(), minRole, createdAt: new Date().toISOString() }, ...x.notes] }));
          setBody("");
        }}
      >
        <textarea aria-label="Note" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Behind the scenes, early news, a question for your community…" className={cn(FIELD, "resize-y py-2")} disabled={!d.ready} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12.5px] text-muted-foreground">
            For{" "}
            <select value={minRole} onChange={(e) => setMinRole(e.target.value as MemberRole)} className="ml-1 min-h-[2.25rem] rounded-full border border-border bg-background px-3 text-[13px] text-foreground">
              {(Object.keys(MEMBER_ROLES) as MemberRole[]).map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLES[r]}s and up
                </option>
              ))}
            </select>
          </label>
          <span className="flex-1" />
          <button type="submit" className={primaryPill} disabled={!d.ready || sending || !body.trim()}>
            {sending ? "Posting…" : "Post note"}
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground">Members see it on your membership page. Nobody is notified.</p>
      </form>
      {d.notes.length ? (
        <GlassGroup label="Your notes">
          {d.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 whitespace-pre-line text-[14px]">{n.body}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground" suppressHydrationWarning>
                  {MEMBER_ROLES[n.minRole]}s and up · {fmt(n.createdAt)}
                </p>
              </div>
              <button type="button" aria-label="Delete note" onClick={() => void act((x) => ({ ...x, notes: x.notes.filter((y) => y.id !== n.id) }), { op: "note_delete", id: n.id })} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition active:bg-black/[0.06]">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </GlassGroup>
      ) : null}
    </section>
  );
}

function Sponsors({ d, setD, act, setNote }: { d: Dashboard; setD: (fn: (x: Dashboard) => Dashboard) => void; act: Act; setNote: (s: string | null) => void }) {
  const [s, setS] = useState({ name: "", kind: "brand" as SponsorKind, url: "" });
  return (
    <section className="mb-6" aria-labelledby="mb-sponsors">
      <SectionHeader id="mb-sponsors" title="Sponsors and partners" />
      <form
        className={cn("mb-2 flex flex-wrap gap-2 rounded-[22px] px-3.5 py-3", GLASS)}
        onSubmit={async (e) => {
          e.preventDefault();
          haptic("selection");
          const out = await post({ op: "sponsor", name: s.name, kind: s.kind, url: s.url || null });
          if (out.error) return setNote(out.error);
          setD((x) => ({ ...x, sponsors: [...x.sponsors, { id: out.data?.id as string, name: s.name.trim(), kind: s.kind, url: s.url.trim() || null }] }));
          setS({ name: "", kind: "brand", url: "" });
        }}
      >
        <input aria-label="Sponsor name" required maxLength={60} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="Name" className={cn(FIELD, "min-w-[8rem] flex-1")} disabled={!d.ready} />
        <select aria-label="Kind" value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value as SponsorKind })} className={cn(FIELD, "w-auto")}>
          {(Object.keys(SPONSOR_KINDS) as SponsorKind[]).map((k) => (
            <option key={k} value={k}>
              {SPONSOR_KINDS[k]}
            </option>
          ))}
        </select>
        <input aria-label="Link" type="url" maxLength={300} value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })} placeholder="https:// (optional)" className={cn(FIELD, "min-w-[10rem] flex-1")} disabled={!d.ready} />
        <button type="submit" className={quietPill} disabled={!d.ready || !s.name.trim()}>
          <Plus className="h-4 w-4" aria-hidden /> Add
        </button>
        <p className="w-full text-[12px] text-muted-foreground">Shown on your membership page, always: members should know who supports you.</p>
      </form>
      {d.sponsors.length ? (
        <GlassGroup label="Sponsors">
          {d.sponsors.map((sp) => (
            <li key={sp.id} className="flex items-center gap-2 px-3.5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{sp.name}</span>
                <span className="block text-[12px] text-muted-foreground">{SPONSOR_KINDS[sp.kind]}</span>
              </span>
              <button type="button" aria-label={`Remove ${sp.name}`} onClick={() => void act((x) => ({ ...x, sponsors: x.sponsors.filter((y) => y.id !== sp.id) }), { op: "sponsor_delete", id: sp.id })} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition active:bg-black/[0.06]">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </GlassGroup>
      ) : null}
    </section>
  );
}
