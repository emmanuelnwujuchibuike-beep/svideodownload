"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatCredits } from "@/lib/ai/credits/units";
import { formatCents } from "@/lib/ai/economy";
import type { LandingSettings } from "@/lib/landing/settings";
import { REWARD_EVENT_LABELS, REWARD_EVENT_SOURCE, REWARD_EVENTS, type RewardEventType, type RewardRule } from "@/lib/rewards/config";
import type { RewardsAdminView } from "@/lib/rewards/admin";
import { cn } from "@/lib/utils";

/**
 * Admin → Frenz AI → Rewards (rewards brief §15, §19; 2026-10-07).
 *
 * The rules (saved as `frenzRewards` — the SQL engine reads them on the next
 * event), the referral analytics and the manual withdrawal queue. The
 * analytics are fetched when this tab is opened and never on a timer.
 */
type RuleRow = { enabled: boolean; actor: string; referrer: string; repeatable: boolean; once: boolean; minSeconds: string; includeFree: boolean };

export function RewardsPanel({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const cfg = settings.frenzRewards;
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [rules, setRules] = useState<Record<RewardEventType, RuleRow>>(
    Object.fromEntries(REWARD_EVENTS.map((e) => { const r = cfg.events[e]; return [e, { enabled: r.enabled, actor: String(r.actorCredits), referrer: String(r.referrerCredits), repeatable: r.referrerRepeatable, once: r.actorOncePerUser, minSeconds: String(r.minDurationSeconds ?? ""), includeFree: !!r.includeComplimentary }]; })) as Record<RewardEventType, RuleRow>,
  );
  const [q, setQ] = useState({ age: String(cfg.qualification.minAccountAgeDays), eng: String(cfg.qualification.minEngagements), window: String(cfg.attribution.windowDays), extra: (cfg.qualification.extraRequirements ?? []).join("\n") });
  const [w, setW] = useState({ enabled: cfg.withdrawals.enabled, rate: String(cfg.withdrawals.creditsPerUsd), min: String(cfg.withdrawals.minCredits), max: String(cfg.withdrawals.maxCredits), perDay: String(cfg.withdrawals.maxRequestsPerDay), perMonth: String(cfg.withdrawals.maxCreditsPerMonth), review: String(cfg.withdrawals.manualReviewAboveCredits) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const n = (v: string, d: number) => (v.trim() === "" || !Number.isFinite(Number(v)) ? d : Math.max(0, Math.floor(Number(v))));

  const payload = useMemo(
    () => ({
      enabled,
      events: Object.fromEntries(
        REWARD_EVENTS.map((e) => {
          const r = rules[e];
          const d = cfg.events[e];
          const out: Partial<RewardRule> = { enabled: r.enabled, actorCredits: n(r.actor, 0), referrerCredits: n(r.referrer, 0), referrerRepeatable: r.repeatable, actorOncePerUser: r.once };
          if (d.minDurationSeconds !== undefined) out.minDurationSeconds = Math.max(1, n(r.minSeconds, d.minDurationSeconds));
          if (d.includeComplimentary !== undefined) out.includeComplimentary = r.includeFree;
          if (d.features) out.features = d.features;
          return [e, out];
        }),
      ),
      qualification: { minAccountAgeDays: n(q.age, 30), minEngagements: n(q.eng, 100), extraRequirements: q.extra.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8) },
      attribution: { windowDays: Math.max(1, n(q.window, 7)) },
      withdrawals: { enabled: w.enabled, creditsPerUsd: Math.max(1, n(w.rate, 10)), minCredits: Math.max(1, n(w.min, 100)), maxCredits: Math.max(1, n(w.max, 10000)), maxRequestsPerDay: Math.max(1, n(w.perDay, 1)), maxCreditsPerMonth: Math.max(1, n(w.perMonth, 50000)), manualReviewAboveCredits: n(w.review, 0), methods: cfg.withdrawals.methods },
    }),
    [cfg.events, cfg.withdrawals.methods, enabled, q, rules, w],
  );

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzRewards: payload }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. The next reward uses these rules; past rewards keep theirs." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm tabular-nums";
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="font-semibold">Rewards &amp; referrals — the rules</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Every reward is granted by the server, once per event (a referred member + an event type = one reward unless marked repeatable). Rewards earned before a member qualifies are
          usable credits forever; after qualification, new rewards are withdrawable. Nothing is recalculated later.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Rewards on</label>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">Event</th><th>On</th><th>To the member</th><th>To their referrer</th><th>Referrer repeatable</th><th>Once per member</th><th>Extra</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {REWARD_EVENTS.map((e) => {
                const r = rules[e];
                const set = (patch: Partial<RuleRow>) => setRules((all) => ({ ...all, [e]: { ...all[e], ...patch } }));
                const planned = REWARD_EVENT_SOURCE[e] === "planned";
                return (
                  <tr key={e} className={cn(planned && "opacity-60")}>
                    <td className="py-2 pr-2">{REWARD_EVENT_LABELS[e]}{planned ? <span className="ml-1 text-[11px] text-muted-foreground">(no source yet)</span> : null}</td>
                    <td><input type="checkbox" aria-label={`${e} on`} checked={r.enabled} onChange={(x) => set({ enabled: x.target.checked })} /></td>
                    <td><input aria-label={`${e} member credits`} inputMode="numeric" value={r.actor} onChange={(x) => set({ actor: x.target.value })} className={input} /></td>
                    <td><input aria-label={`${e} referrer credits`} inputMode="numeric" value={r.referrer} onChange={(x) => set({ referrer: x.target.value })} className={input} /></td>
                    <td><input type="checkbox" aria-label={`${e} referrer repeatable`} checked={r.repeatable} onChange={(x) => set({ repeatable: x.target.checked })} /></td>
                    <td><input type="checkbox" aria-label={`${e} once per member`} checked={r.once} onChange={(x) => set({ once: x.target.checked })} /></td>
                    <td className="text-xs">
                      {cfg.events[e].minDurationSeconds !== undefined ? <label>min <input inputMode="numeric" value={r.minSeconds} onChange={(x) => set({ minSeconds: x.target.value })} className={cn(input, "w-14")} /> s</label> : null}
                      {cfg.events[e].includeComplimentary !== undefined ? <label className="flex items-center gap-1"><input type="checkbox" checked={r.includeFree} onChange={(x) => set({ includeFree: x.target.checked })} /> free videos earn too</label> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">Withdrawal qualification: account age (days)<input inputMode="numeric" value={q.age} onChange={(x) => setQ({ ...q, age: x.target.value })} className={cn(input, "mt-1 block")} /></label>
          <label className="text-xs text-muted-foreground">Qualifying referral engagements<input inputMode="numeric" value={q.eng} onChange={(x) => setQ({ ...q, eng: x.target.value })} className={cn(input, "mt-1 block")} /></label>
          <label className="text-xs text-muted-foreground">Attribution window for a new account (days)<input inputMode="numeric" value={q.window} onChange={(x) => setQ({ ...q, window: x.target.value })} className={cn(input, "mt-1 block")} /></label>
        </div>
        <label className="mt-3 block text-xs text-muted-foreground">
          Extra withdrawal requirements — one per line, up to 8 (shown to members; your team checks them when reviewing an application). Set age or engagements to 0 to drop that requirement.
          <textarea value={q.extra} onChange={(x) => setQ({ ...q, extra: x.target.value })} rows={3} placeholder={"Verified email address\nProfile photo and display name set"} className={cn(input, "mt-1 block w-full")} />
        </label>
        <div className="mt-5 rounded-2xl border border-border/70 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={w.enabled} onChange={(x) => setW({ ...w, enabled: x.target.checked })} /> Withdrawals open (paid out by hand)</label>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="text-xs text-muted-foreground">Withdrawal rate — credits per $1 (separate from the top-up rate)<input inputMode="numeric" value={w.rate} onChange={(x) => setW({ ...w, rate: x.target.value })} className={cn(input, "mt-1 block")} /></label>
            <label className="text-xs text-muted-foreground">Minimum credits<input inputMode="numeric" value={w.min} onChange={(x) => setW({ ...w, min: x.target.value })} className={cn(input, "mt-1 block")} /></label>
            <label className="text-xs text-muted-foreground">Maximum credits<input inputMode="numeric" value={w.max} onChange={(x) => setW({ ...w, max: x.target.value })} className={cn(input, "mt-1 block")} /></label>
            <label className="text-xs text-muted-foreground">Requests per day<input inputMode="numeric" value={w.perDay} onChange={(x) => setW({ ...w, perDay: x.target.value })} className={cn(input, "mt-1 block")} /></label>
            <label className="text-xs text-muted-foreground">Credits per 30 days<input inputMode="numeric" value={w.perMonth} onChange={(x) => setW({ ...w, perMonth: x.target.value })} className={cn(input, "mt-1 block")} /></label>
            <label className="text-xs text-muted-foreground">Review above (credits)<input inputMode="numeric" value={w.review} onChange={(x) => setW({ ...w, review: x.target.value })} className={cn(input, "mt-1 block")} /></label>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={busy} className={cn("btn-lux bg-foreground text-background", busy && "opacity-60")}>{busy ? "Saving…" : "Save reward rules"}</button>
          <span className="text-xs text-muted-foreground">Rules version {cfg.version}</span>
          {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
        </div>
      </section>
      <RewardsActivity minAge={cfg.qualification.minAccountAgeDays} minEngagements={cfg.qualification.minEngagements} />
    </div>
  );
}

function RewardsActivity({ minAge, minEngagements }: { minAge: number; minEngagements: number }) {
  const [view, setView] = useState<RewardsAdminView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restrict, setRestrict] = useState({ email: "", reason: "", restricted: true });
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/rewards", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't load rewards.");
    setView((await res.json()) as RewardsAdminView);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const move = async (id: string, status: string) => {
    const payoutReference = status === "completed" ? window.prompt("Payout reference (the bank transfer id):")?.trim() : undefined;
    if (status === "completed" && !payoutReference) return;
    const res = await fetch(`/api/admin/rewards/withdrawals/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...(payoutReference ? { payoutReference } : {}) }) });
    const json = await res.json().catch(() => ({}));
    setNote(res.ok ? `Moved to ${status}.` : (json.error ?? "Failed."));
    if (res.ok) void load();
  };
  // 0191: an application is decided here — approve sets the member's qualification, reject keeps their AI credits as they are
  const review = async (userId: string, approve: boolean) => {
    const note = approve ? undefined : (window.prompt("Reason shown to the member (optional):") ?? undefined);
    const res = await fetch("/api/admin/rewards/qualification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, approve, ...(note ? { note } : {}) }) });
    const json = await res.json().catch(() => ({}));
    setNote(res.ok ? (approve ? "Approved for withdrawals." : "Application rejected.") : (json.error ?? "Failed."));
    if (res.ok) void load();
  };
  const submitRestrict = async () => {
    const res = await fetch("/api/admin/rewards/restrict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: restrict.email, restricted: restrict.restricted, reason: restrict.reason || undefined }) });
    const json = await res.json().catch(() => ({}));
    setNote(res.ok ? (restrict.restricted ? "Restricted." : "Restriction cleared.") : (json.error ?? "Failed."));
    if (res.ok) void load();
  };

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!view) return <div className="h-40 animate-pulse rounded-3xl bg-secondary/60" aria-busy="true" aria-label="Loading rewards" />;
  const t = view.totals;
  const cards: [string, string][] = [
    ["Link clicks", t.clicks.toLocaleString("en-US")],
    ["Sign-ups from links", t.signupsFromLinks.toLocaleString("en-US")],
    ["Referred accounts", t.referredAccounts.toLocaleString("en-US")],
    ["Active referred (30 d)", t.activeReferred30d.toLocaleString("en-US")],
    ["Qualifying engagements", t.qualifyingEngagements.toLocaleString("en-US")],
    ["AI generation rewards", t.aiGenerationRewards.toLocaleString("en-US")],
    ["AI share rewards", t.aiShareRewards.toLocaleString("en-US")],
    ["AI Reels published", t.aiReels === null ? "—" : t.aiReels.toLocaleString("en-US")],
    ["AI videos generated", t.aiVideoGenerations === null ? "—" : t.aiVideoGenerations.toLocaleString("en-US")],
    ["Usable issued", formatCredits(t.usableIssued, { short: true })],
    ["Withdrawable issued", formatCredits(t.withdrawableIssued, { short: true })],
    ["Qualified members", t.qualifiedMembers.toLocaleString("en-US")],
    ["Restricted members", t.restrictedMembers.toLocaleString("en-US")],
    ["Paid out", `${formatCredits(view.withdrawals.completedCredits, { short: true })} · ${formatCents(view.withdrawals.completedUsdCents, "$")}`],
  ];
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Referrals, rewards &amp; withdrawals · last {view.windowDays} days</h2>
        <button type="button" onClick={() => void load()} className="text-xs font-semibold text-primary">Refresh</button>
      </div>
      {view.capped ? <p className="mt-1 text-xs text-muted-foreground">Capped at the most recent 20,000 rows.</p> : null}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border/70 px-3 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {/* 0191 — members' progress and activity (day / week / month), applications first */}
      <h3 className="mt-6 text-sm font-semibold">
        Withdrawal qualification · {view.members.filter((m) => m.status === "applied").length} waiting
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Requirements now: {minAge} days · {minEngagements} qualifying engagements. Referral = rewarded actions by people they invited; Own = their own rewarded actions. Counted when you open this tab.
      </p>
      {view.members.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No members with rewards yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-2xl border border-border/70">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="bg-secondary/50 text-[11px] uppercase tracking-[0.05em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Member</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Account age</th>
                <th className="px-3 py-2">Engagements</th>
                <th className="px-3 py-2">Referral d / w / m</th>
                <th className="px-3 py-2">Own d / w / m</th>
                <th className="px-3 py-2">Earned (usable · withdrawable)</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {view.members.map((m) => {
                const agePct = Math.min(100, minAge ? Math.round((m.accountAgeDays / minAge) * 100) : 100);
                const engPct = Math.min(100, minEngagements ? Math.round((m.engagements / minEngagements) * 100) : 100);
                return (
                  <tr key={m.userId} className={m.status === "applied" ? "bg-indigo-500/[0.04]" : undefined}>
                    <td className="px-3 py-2 font-medium">{m.user}{m.restricted ? <span className="ml-1 text-rose-600">· restricted</span> : null}</td>
                    <td className="px-3 py-2 capitalize">{m.status}{m.appliedAt && m.status === "applied" ? <span className="block text-[10.5px] text-muted-foreground">{m.appliedAt.slice(0, 10)}</span> : null}</td>
                    <td className="px-3 py-2"><Meter pct={agePct} label={`${m.accountAgeDays} / ${minAge} d`} /></td>
                    <td className="px-3 py-2"><Meter pct={engPct} label={`${m.engagements} / ${minEngagements}`} /></td>
                    <td className="px-3 py-2 tabular-nums">{m.referral.day} / {m.referral.week} / {m.referral.month}</td>
                    <td className="px-3 py-2 tabular-nums">{m.own.day} / {m.own.week} / {m.own.month}</td>
                    <td className="px-3 py-2 tabular-nums">{m.earnedUsable} · {m.earnedWithdrawable}{m.withdrawableNow ? <span className="block text-[10.5px] text-muted-foreground">{m.withdrawableNow} withdrawable now</span> : null}</td>
                    <td className="px-3 py-2">
                      {m.status === "applied" ? (
                        <span className="flex gap-1.5">
                          <button type="button" onClick={() => void review(m.userId, true)} className="rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white">Approve</button>
                          <button type="button" onClick={() => void review(m.userId, false)} className="rounded-lg border border-border px-2.5 py-1 font-semibold">Reject</button>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="mt-6 text-sm font-semibold">Withdrawal queue ({view.queue.length})</h3>
      {view.queue.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border/60 rounded-2xl border border-border/70">
          {view.queue.map((q) => (
            <li key={q.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{q.user}</strong> · {formatCredits(q.credits)} → {formatCents(q.usdCents, "$")} · <span className="uppercase text-xs">{q.status}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {q.status === "pending" ? <button type="button" onClick={() => void move(q.id, "reviewing")} className="rounded-lg border border-border px-2 py-1 text-xs">Review</button> : null}
                  {q.status === "pending" || q.status === "reviewing" ? <button type="button" onClick={() => void move(q.id, "approved")} className="rounded-lg border border-border px-2 py-1 text-xs">Approve</button> : null}
                  {q.status === "approved" || q.status === "processing" ? <button type="button" onClick={() => void move(q.id, "completed")} className="rounded-lg border border-emerald-500/50 px-2 py-1 text-xs text-emerald-700">Mark paid</button> : null}
                  <button type="button" onClick={() => void move(q.id, "rejected")} className="rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-600">Reject (return credits)</button>
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {q.method} · {Object.entries(q.details).map(([k, v]) => `${k}: ${v}`).join(" · ")} · {new Date(q.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-sm font-semibold">Recent referral rewards</h3>
      {view.recentReferrals.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No referral rewards yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">When</th><th>Referrer</th><th>Referred</th><th>Shared</th><th>Event</th><th>Reward</th><th>Class</th></tr></thead>
            <tbody className="divide-y divide-border/60">
              {view.recentReferrals.map((r, i) => (
                <tr key={i}><td className="py-1">{new Date(r.at).toLocaleString()}</td><td>{r.referrer}</td><td>{r.referred ?? "—"}</td><td>{r.contentType ?? "—"}</td><td>{REWARD_EVENT_LABELS[r.event as RewardEventType] ?? r.event}</td><td className="tabular-nums">{r.amount}</td><td>{r.creditClass}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold">Restrict a member (fraud)</h3>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input type="email" placeholder="member@email" value={restrict.email} onChange={(e) => setRestrict({ ...restrict, email: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1 text-sm" />
        <input placeholder="Reason" value={restrict.reason} onChange={(e) => setRestrict({ ...restrict, reason: e.target.value })} className="rounded-lg border border-border bg-background px-2 py-1 text-sm" />
        <select value={restrict.restricted ? "1" : "0"} onChange={(e) => setRestrict({ ...restrict, restricted: e.target.value === "1" })} className="rounded-lg border border-border bg-background px-2 py-1 text-sm">
          <option value="1">Restrict</option>
          <option value="0">Clear restriction</option>
        </select>
        <button type="button" onClick={() => void submitRestrict()} disabled={!restrict.email.includes("@")} className="rounded-lg border border-border px-3 py-1 text-sm disabled:opacity-50">Apply</button>
      </div>
      {note ? <p className="mt-3 text-sm text-muted-foreground">{note}</p> : null}
    </section>
  );
}

/** A thin progress bar with its figure — the admin's "how far along" at a glance. */
function Meter({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="min-w-[96px]">
      <span className="tabular-nums">{label}</span>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
