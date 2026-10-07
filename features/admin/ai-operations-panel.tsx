"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import type { AiOperations, FailureOwner, OpsJob } from "@/lib/ai/admin-ops-view";
import { cn } from "@/lib/utils";

/**
 * Admin → Frenz AI → Overview: the operations panel (Part 8 §7/§62, §35–§39).
 *
 * Everything here comes from ONE bounded read made when the section was opened
 * (lib/ai/admin-ops.ts) — the filters only narrow rows already in the page, so
 * changing one costs no request. Figures that the rows cannot support are not
 * shown (§62: no fabricated metrics): revenue is wallet money only, Kling units
 * are labelled as the quote's estimate.
 */

const OWNER_LABEL: Record<FailureOwner, string> = { provider: "Provider (Kling / ElevenLabs)", frenzsave: "FrenzSave (our side)", member: "Member input" };
const OWNER_TONE: Record<FailureOwner, string> = { provider: "text-amber-600", frenzsave: "text-rose-600", member: "text-muted-foreground" };

type KlingState = "healthy" | "degraded" | "unavailable" | "unknown";
const KLING_LABEL: Record<KlingState, { text: string; tone: string }> = {
  healthy: { text: "Kling — healthy", tone: "text-emerald-600" },
  degraded: { text: "Kling — degraded", tone: "text-amber-600" },
  unavailable: { text: "Kling — not configured", tone: "text-rose-600" },
  unknown: { text: "Kling — no recent jobs", tone: "text-muted-foreground" },
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const dur = (ms: number | null) => (ms === null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`);

export function AiOperationsPanel({
  ops,
  labels,
  kling,
  currencySymbol,
}: {
  ops: AiOperations;
  /** feature id → its name, resolved on the server (keeps the job registry out of this bundle). */
  labels: Record<string, string>;
  kling: KlingState;
  currencySymbol: string;
}) {
  const name = (f: string) => labels[f] ?? f.replace(/^ai_/, "").replace(/_/g, " ");
  const o = ops.overview;

  if (ops.unreadable) {
    return (
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">AI operations</h2>
        <p className="text-sm text-muted-foreground">Couldn&apos;t read the jobs just now — nothing is affected, this panel only reads.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── §7 / §62 the cards ── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">AI operations</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Every tool, the last {ops.windowDays} days{ops.truncated ? " (most recent 500 jobs)" : ""}. Read when you opened this section — nothing refreshes on its own.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="Video provider" value={KLING_LABEL[kling].text} tone={KLING_LABEL[kling].tone} small hint="From real jobs. Test the key under Kling pricing." />
          <Card
            label="Failure rate today"
            value={o.failureRateToday === null ? "—" : `${Math.round(o.failureRateToday * 100)}%`}
            tone={o.failureRateToday !== null && o.failureRateToday > 0.25 ? "text-rose-600" : undefined}
            hint={`${o.failedToday} failed of ${o.completedToday + o.failedToday} finished`}
          />
          <Card
            label="Wallet revenue today"
            value={`${currencySymbol}${(o.walletRevenueTodayCents / 100).toFixed(2)}`}
            hint={`Completed, paid from wallets${o.freeToday || o.creditsToday ? ` · ${o.freeToday} free · ${o.creditsToday} on credits` : ""}`}
          />
          <Card
            label="Kling units today (est.)"
            value={o.klingUnitsToday.jobs ? String(o.klingUnitsToday.units) : "—"}
            hint={o.klingUnitsToday.jobs ? `${o.klingUnitsToday.withEstimate} of ${o.klingUnitsToday.jobs} Kling jobs estimated from their quote` : "No Kling job finished today"}
          />
        </div>
      </section>

      {/* ── §38 / §39 failures, grouped ── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Failures</h2>
        <p className="mb-4 text-sm text-muted-foreground">Repeated failures are one row. Whose problem it is decides who fixes it.</p>
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {(Object.keys(OWNER_LABEL) as FailureOwner[]).map((k) => (
            <span key={k}>
              <span className={cn("font-semibold tabular-nums", OWNER_TONE[k])}>{ops.failuresByOwner[k]}</span> <span className="text-muted-foreground">{OWNER_LABEL[k]}</span>
            </span>
          ))}
        </div>
        {ops.errorGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failures in this window.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {ops.errorGroups.slice(0, 12).map((g) => (
              <li key={`${g.code}|${g.feature}`} className="px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12.5px] font-semibold">{g.code}</span>
                  <span className="tabular-nums text-muted-foreground">
                    ×{g.occurrences} · {name(g.feature)}
                  </span>
                </div>
                <p className={cn("mt-0.5 text-xs", OWNER_TONE[g.owner])}>{OWNER_LABEL[g.owner]}</p>
                {g.example ? <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{g.example}</p> : null}
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  First {when(g.firstSeen)} · last {when(g.lastSeen)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── §35–§37 the jobs ── */}
      <JobsList jobs={ops.jobs} name={name} currencySymbol={currencySymbol} />
    </div>
  );
}

function Card({ label, value, hint, tone, small }: { label: string; value: string; hint?: string; tone?: string; small?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-secondary/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-bold tabular-nums", small ? "text-sm" : "text-xl", tone)}>{value}</p>
      {hint ? <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const ALL = "all";

function JobsList({ jobs, name, currencySymbol }: { jobs: OpsJob[]; name: (f: string) => string; currencySymbol: string }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [provider, setProvider] = useState(ALL);
  const [billing, setBilling] = useState(ALL);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [user, setUser] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const options = useMemo(
    () => ({
      feature: [...new Set(jobs.map((j) => j.feature))],
      status: [...new Set(jobs.map((j) => j.status))],
      provider: [...new Set(jobs.map((j) => j.provider))],
      billing: [...new Set(jobs.map((j) => j.billing))],
    }),
    [jobs],
  );
  const shown = jobs.filter(
    (j) =>
      (feature === ALL || j.feature === feature) &&
      (status === ALL || j.status === status) &&
      (provider === ALL || j.provider === provider) &&
      (billing === ALL || j.billing === billing) &&
      (!failuresOnly || j.failed) &&
      (!user.trim() || (j.userId ?? "").startsWith(user.trim())),
  );
  const active = [feature, status, provider, billing].filter((v) => v !== ALL).length + (failuresOnly ? 1 : 0) + (user.trim() ? 1 : 0);

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Jobs</h2>
          <p className="text-sm text-muted-foreground">
            {shown.length} of {jobs.length}
          </p>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3 text-sm font-semibold">
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filters{active ? ` (${active})` : ""}
        </button>
      </div>

      {open ? (
        <div className="mb-4 grid gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-3 sm:grid-cols-3">
          <Pick label="Tool" value={feature} onChange={setFeature} options={options.feature} render={name} />
          <Pick label="Status" value={status} onChange={setStatus} options={options.status} />
          <Pick label="Provider" value={provider} onChange={setProvider} options={options.provider} />
          <Pick label="Funding" value={billing} onChange={setBilling} options={options.billing} />
          <label className="flex flex-col gap-1 text-xs font-medium">
            Member id starts with
            <input value={user} onChange={(e) => setUser(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 font-mono text-sm" placeholder="e.g. bb520a2e" />
          </label>
          <label className="flex items-center gap-2 self-end text-sm font-medium">
            <input type="checkbox" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} className="h-4 w-4" />
            Failures only
          </label>
        </div>
      ) : null}

      <ul className="divide-y divide-border rounded-2xl border border-border">
        {shown.slice(0, 100).map((j) => {
          const isOpen = expanded === j.id;
          return (
            <li key={j.id}>
              <button type="button" onClick={() => setExpanded(isOpen ? null : j.id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", j.failed ? "bg-rose-500" : j.status === "completed" ? "bg-emerald-500" : "bg-sky-500")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {name(j.feature)} · <span className="text-muted-foreground">{j.provider}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {j.status}
                    {j.failure ? ` · ${j.failure.code}` : ""} · {when(j.createdAt)}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{j.failed ? "failed" : j.billing === "paid" && j.chargedCents !== null ? `${currencySymbol}${(j.chargedCents / 100).toFixed(2)}` : j.billing}</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden />
              </button>
              {isOpen ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-border/60 bg-secondary/20 px-3 py-3 text-xs">
                  <Row k="Job" v={j.id} mono />
                  <Row k="Member" v={j.userId ?? "guest"} mono />
                  <Row k="Tool" v={name(j.feature)} />
                  <Row k="Provider" v={j.provider} />
                  <Row k="Status" v={j.status} />
                  <Row k="Created" v={when(j.createdAt)} />
                  <Row k="Started" v={when(j.startedAt)} />
                  <Row k="Finished" v={when(j.completedAt)} />
                  <Row k="Processing" v={dur(j.processingMs)} />
                  <Row k="Funding" v={j.billing === "paid" && j.chargedCents !== null ? `paid · ${currencySymbol}${(j.chargedCents / 100).toFixed(2)}` : j.billing} />
                  {j.estimatedUnits !== null ? <Row k="Kling units (est.)" v={String(j.estimatedUnits)} /> : null}
                  <Row k="Provider task" v={j.providerTaskId ?? "—"} mono />
                  {j.failure ? <Row k="Failure" v={`${j.failure.code} — ${OWNER_LABEL[j.failure.owner]}${j.failure.detail ? `: ${j.failure.detail}` : ""}`} /> : null}
                  <Row k="Notified" v={j.status !== "completed" ? "—" : j.notifyPending ? "not yet" : "yes"} />
                </dl>
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">No jobs match.</li> : null}
      </ul>
    </section>
  );
}

function Pick({ label, value, onChange, options, render }: { label: string; value: string; onChange: (v: string) => void; options: string[]; render?: (v: string) => string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-2 text-sm">
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {render ? render(o) : o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono")}>{v}</dd>
    </>
  );
}
