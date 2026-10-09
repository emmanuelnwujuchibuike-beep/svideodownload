"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { useShownOnce } from "./use-shown-once";

/**
 * Admin → Ads → Traffic & safety (Ad Platform Part 8). What 0206 detects, in
 * one place:
 *   · review flags: invalid traffic, click anomalies, unsafe links, payment
 *     reversals, broken creatives, self traffic
 *   · seven days of qualifying vs filtered traffic, with the filtered reasons
 *   · creatives and links that failed or wait on a person
 *   · the traffic thresholds in force
 * No IP or IP hash ever reaches this screen, only counts. Loads when the tab
 * is first shown, then on Refresh. Never polled.
 */

interface Flag {
  id: number;
  kind: string;
  severity: string;
  status: string;
  day: string;
  hits: number;
  evidence: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  campaign: { id: string; name: string; status: string } | null;
  advertiser: { id: string; name: string; status: string } | null;
}
interface Overview {
  flags: Flag[];
  traffic: { campaignId: string; name: string; qualifying: number; filtered: number; loadFailures: number }[];
  reasons: { reason: string; events: number }[];
  creatives: { id: string; campaignId: string; campaign: string; problem: string; detail: string | null; at: string | null }[];
  paymentIssues: number;
  rules: Record<string, number>;
  bounds: Record<string, [number, number]>;
}

const KIND_WORDS: Record<string, string> = {
  invalid_traffic: "Most of today's traffic was filtered",
  click_anomaly: "Many filtered clicks today",
  creative_load_failures: "The creative keeps failing to load",
  self_traffic: "The advertiser keeps viewing their own ads",
  unsafe_destination: "Its link points to a blocked domain (paused)",
  payment_chargeback: "Chargeback on the payment",
  payment_mismatch: "Payment amount or currency mismatch",
  payment_verification_required: "Payment needs verification",
  payment_refunded: "Payment refunded",
  payment_partially_refunded: "Payment partly refunded",
};
const REASON_WORDS: Record<string, string> = {
  bot_signature: "Automated client",
  internal_traffic: "Frenzsave staff",
  self_traffic: "The advertiser's own views",
  frequency_visitor: "Same visitor too often",
  frequency_network: "Same network too often",
  click_without_view: "Click without a view",
  conversion_without_click: "Detail without a click",
  outbound_without_click: "Visit without a detail view",
  repeat_click: "Repeat clicks",
  network_click_volume: "Too many clicks from one network",
  completion_without_start: "Completion without a start",
  completion_too_fast: "Completion too fast for the video",
  ineligible: "Campaign not live at the time",
  type_not_for_format: "Event that doesn't fit the format",
  stale_event: "Old or future-dated event",
  admin_excluded: "Excluded by an admin",
};
const PROBLEM_WORDS: Record<string, string> = {
  content_rejected: "Content rejected",
  creative_blocked: "Creative blocked",
  creative_invalid: "File failed its checks",
  link_blocked: "Link blocked",
  link_review: "Link waits on a person",
  safety_review: "Content waits on a person",
};
const RULE_WORDS: Record<string, string> = {
  max_events_per_minute_per_ip: "Events per minute from one network (batch refused above)",
  max_events_per_minute_per_visitor: "Events per minute from one visitor (batch refused above)",
  impressions_per_visitor_hour: "Impressions per visitor per campaign per hour",
  impressions_per_ip_hour: "Impressions per network per campaign per hour",
  clicks_per_visitor_day: "Clicks per visitor per campaign per day",
  clicks_per_ip_day: "Clicks per network per campaign per day",
  click_view_window_minutes: "A click counts if the ad was seen within (minutes)",
  min_completion_ratio: "A video completion needs this share of its length (0–1)",
  flag_min_events: "Flag a campaign only after this many events a day",
  flag_invalid_ratio: "…when this share is filtered (0–1)",
  flag_invalid_clicks: "Flag after this many filtered clicks a day",
  flag_load_failures: "Flag after this many load failures a day",
  flag_self_traffic: "Flag an advertiser after this many self views a day",
  raw_retention_days: "Keep raw events for (days)",
  ip_hash_retention_days: "Keep the network hash for (days)",
  flag_retention_days: "Keep resolved flags for (days)",
};
const SEV: Record<string, string> = { high: "bg-rose-100 text-rose-800", medium: "bg-amber-100 text-amber-800", low: "bg-slate-100 text-slate-700" };
const when = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const box = "rounded-2xl border border-border/70 bg-card p-4";

export function AdSafetyCenter() {
  const { ref, shown } = useShownOnce<HTMLDivElement>();
  const [view, setView] = useState<"open" | "resolved">("open");
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function load(v = view) {
    setBusy(true);
    const res = await fetch(`/api/admin/ads/safety?view=${v}`, { cache: "no-store" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ tone: "bad", text: "Couldn't load. Try Refresh." });
    setData((await res.json()) as Overview);
  }

  useEffect(() => {
    if (shown) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads are explicit
  }, [shown]);

  async function send(method: "POST" | "PATCH", body: unknown, ok: string) {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/admin/ads/safety", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; reason?: string; error?: string; valid?: number; invalid?: number } | null;
    if (res?.ok && out?.ok !== false) {
      setNote({ tone: "ok", text: out?.valid !== undefined ? `${ok} ${out.valid} valid, ${out.invalid ?? 0} not.` : ok });
      void load();
      return true;
    }
    setNote({ tone: "bad", text: out?.reason === "already_resolved" ? "Someone already decided on this flag." : (out?.error ?? "That didn't go through. Nothing changed.") });
    return false;
  }

  return (
    <div ref={ref} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["open", "resolved"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              void load(v);
            }}
            className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset", view === v ? "bg-primary text-primary-foreground ring-primary" : "bg-card ring-border")}
          >
            {v === "open" ? `Open flags${data && view === "open" ? ` ${data.flags.length}` : ""}` : "Resolved"}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => void load()} className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs font-semibold disabled:opacity-60">
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {note ? <p className={cn("rounded-xl px-3 py-2 text-xs font-medium", note.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700")}>{note.text}</p> : null}
      {!data ? <p className="text-xs text-muted-foreground">Loading…</p> : null}

      {data ? (
        <>
          {data.paymentIssues > 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              {data.paymentIssues} payment item{data.paymentIssues === 1 ? "" : "s"} need a look — see the Campaign payments tab.
            </p>
          ) : null}

          <section className={box}>
            <h3 className="text-sm font-semibold">{view === "open" ? "Flags to review" : "Resolved flags"}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Raised automatically. Filtered events already don&apos;t count — a flag asks whether more is needed. Dismiss a false alarm or confirm it, with a note.</p>
            {data.flags.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{view === "open" ? "Nothing to review." : "No resolved flags yet."}</p> : null}
            <ul className="mt-2 space-y-2">
              {data.flags.map((f) => (
                <FlagRow key={f.id} f={f} busy={busy} onResolve={(action, text, exclude) => send("POST", { flag: f.id, action, note: text, exclude }, action === "dismiss" ? "Flag dismissed." : "Flag confirmed.")} onRevalidate={(id) => send("POST", { revalidate: id }, "Rechecked:")} />
              ))}
            </ul>
          </section>

          <section className={box}>
            <h3 className="text-sm font-semibold">Traffic quality — last 7 days</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Qualifying = impressions and clicks that count for the advertiser. Filtered events are kept as evidence and never count.</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Campaign</th>
                    <th className="py-1 text-right font-medium">Counted</th>
                    <th className="py-1 text-right font-medium">Filtered</th>
                    <th className="py-1 text-right font-medium">Load fails</th>
                  </tr>
                </thead>
                <tbody>
                  {data.traffic.map((t) => (
                    <tr key={t.campaignId} className="border-t border-border/60">
                      <td className="max-w-[10rem] truncate py-1">{t.name}</td>
                      <td className="py-1 text-right tabular-nums">{t.qualifying.toLocaleString("en-US")}</td>
                      <td className={cn("py-1 text-right tabular-nums", t.filtered > t.qualifying && t.filtered > 0 && "font-semibold text-rose-700")}>{t.filtered.toLocaleString("en-US")}</td>
                      <td className="py-1 text-right tabular-nums">{t.loadFailures.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                  {data.traffic.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-2 text-muted-foreground">
                        No traffic in the last 7 days.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <ul className="space-y-1 text-[11.5px]">
                <li className="font-medium text-muted-foreground">Why events were filtered</li>
                {data.reasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-2">
                    <span>{REASON_WORDS[r.reason] ?? r.reason}</span>
                    <span className="tabular-nums">{r.events.toLocaleString("en-US")}</span>
                  </li>
                ))}
                {data.reasons.length === 0 ? <li className="text-muted-foreground">Nothing filtered.</li> : null}
              </ul>
            </div>
          </section>

          <section className={box}>
            <h3 className="text-sm font-semibold">Creatives and links — last 7 days</h3>
            <ul className="mt-2 divide-y divide-border/60 text-[11.5px]">
              {data.creatives.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <strong>{c.campaign}</strong> · {PROBLEM_WORDS[c.problem] ?? c.problem}
                    {c.detail ? <span className="text-muted-foreground"> — {c.detail}</span> : null}
                  </span>
                  <span className="text-muted-foreground">{when(c.at)}</span>
                </li>
              ))}
              {data.creatives.length === 0 ? <li className="py-2 text-muted-foreground">No creative or link problems.</li> : null}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">To approve something waiting on a person, use Approve in the Campaigns tab.</p>
          </section>

          <Rules rules={data.rules} bounds={data.bounds} busy={busy} onSave={(patch) => send("PATCH", { rules: patch }, "Traffic rules saved.")} />
        </>
      ) : null}
    </div>
  );
}

function FlagRow({ f, busy, onResolve, onRevalidate }: { f: Flag; busy: boolean; onResolve: (a: "dismiss" | "confirm", note: string, exclude: boolean) => Promise<boolean>; onRevalidate: (campaignId: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [exclude, setExclude] = useState(false);
  const canExclude = f.kind === "invalid_traffic" || f.kind === "click_anomaly";
  const evidence = Object.entries(f.evidence)
    .filter(([k]) => k !== "excluded")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
  return (
    <li className="rounded-xl bg-muted/40 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase", SEV[f.severity] ?? SEV.low)}>{f.severity}</span>
        <span className="font-semibold">{KIND_WORDS[f.kind] ?? f.kind}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {f.day} · seen {f.hits}× · last {when(f.lastSeen)}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        {f.campaign ? (
          <>
            Campaign <strong className="text-foreground">{f.campaign.name}</strong> ({f.campaign.status})
          </>
        ) : null}
        {f.advertiser ? <> · Advertiser <strong className="text-foreground">{f.advertiser.name}</strong> ({f.advertiser.status})</> : null}
      </p>
      {evidence ? <p className="mt-0.5 text-[11px] text-muted-foreground">{evidence}</p> : null}
      {f.status === "open" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Note (required) — what you found" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label="Note" />
          {canExclude ? (
            <label className="flex items-center gap-1 text-[11px]">
              <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> exclude that day&apos;s counts
            </label>
          ) : null}
          <button type="button" disabled={busy || !text.trim()} onClick={() => void onResolve("dismiss", text.trim(), false)} className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
            Dismiss
          </button>
          <button type="button" disabled={busy || !text.trim()} onClick={() => void onResolve("confirm", text.trim(), exclude)} className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
            Confirm
          </button>
          {f.campaign ? (
            <button type="button" disabled={busy} onClick={() => void onRevalidate(f.campaign!.id)} className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
              Recheck creative + link
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-[11px]">
          <strong>{f.status}</strong> {when(f.resolvedAt)} — {f.resolutionNote}
        </p>
      )}
      {f.status === "open" ? <p className="mt-1 text-[10.5px] text-muted-foreground">To pause, remove or suspend, use the Campaigns tab.</p> : null}
    </li>
  );
}

function Rules({ rules, bounds, busy, onSave }: { rules: Record<string, number>; bounds: Record<string, [number, number]>; busy: boolean; onSave: (patch: Record<string, number>) => Promise<boolean> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const changed = Object.entries(draft).filter(([k, v]) => v !== "" && Number(v) !== rules[k]);
  const valid = changed.every(([k, v]) => {
    const n = Number(v);
    const b = bounds[k];
    return Number.isFinite(n) && (!b || (n >= b[0] && n <= b[1]));
  });
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Traffic rules</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Thresholds the database applies to every event. Networks are counted per day by a one-way hash, and a shared network alone never filters anyone.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {Object.keys(RULE_WORDS).map((k) => (
          <label key={k} className="text-[11.5px] text-muted-foreground">
            {RULE_WORDS[k]}
            <input
              inputMode="decimal"
              value={draft[k] ?? String(rules[k] ?? "")}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              className="mt-0.5 block w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground tabular-nums"
              aria-label={RULE_WORDS[k]}
            />
            {bounds[k] ? <span className="text-[10.5px]">{bounds[k]![0]}–{bounds[k]![1]}</span> : null}
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || changed.length === 0 || !valid}
        onClick={async () => {
          if (await onSave(Object.fromEntries(changed.map(([k, v]) => [k, Number(v)])))) setDraft({});
        }}
        className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        Save {changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"}` : "rules"}
      </button>
    </section>
  );
}
