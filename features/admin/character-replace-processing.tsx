"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { CHARACTER_REPLACE_PROCESSING_BOUNDS, type CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI → PROCESSING — how many videos run at once, and what happens to the rest
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21 (multi-video brief §16): concurrency per plan, the
 * global cap, videos per batch, the file and duration ceilings, the queue
 * switch, the retry count, the job timeout, the failed-job refund — grouped
 * here and nowhere else, with the bounds the normaliser enforces
 * (CHARACTER_REPLACE_PROCESSING_BOUNDS) shown beside each field so a typo
 * cannot become a dangerous value.
 *
 * Posts ONLY the fields it displays (the route deep-merges the nested
 * object); the pricing panel keeps every other field.
 */
const B = CHARACTER_REPLACE_PROCESSING_BOUNDS;

export function CharacterReplaceProcessingPanel({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const cr = settings.frenzAiCharacterReplace;
  const p = cr.processing;

  const [queueEnabled, setQueueEnabled] = useState(p.queueEnabled);
  const [free, setFree] = useState(String(p.concurrency.free));
  const [pro, setPro] = useState(String(p.concurrency.pro));
  const [business, setBusiness] = useState(String(p.concurrency.business));
  const [maxAi, setMaxAi] = useState(String(p.concurrency.maxAi));
  const [admin, setAdmin] = useState(String(p.concurrency.admin));
  const [maxGlobal, setMaxGlobal] = useState(String(cr.limits.maxActiveJobsGlobal));
  const [maxPerUser, setMaxPerUser] = useState(String(cr.limits.maxActiveJobsPerUser));
  const [maxPerBatch, setMaxPerBatch] = useState(String(p.maxVideosPerBatch));
  const [maxUploadMb, setMaxUploadMb] = useState(String(Math.round(cr.maximumUploadBytes / (1024 * 1024))));
  const [maxSeconds, setMaxSeconds] = useState(String(cr.maximumDurationSeconds));
  const [retries, setRetries] = useState(String(p.autoRetryCount));
  const [timeout, setTimeoutMinutes] = useState(String(p.jobTimeoutMinutes));
  const [refundFailed, setRefundFailed] = useState(p.refundFailedJobs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const int = (raw: string, fallback: number) => {
    const n = Math.floor(Number(raw));
    return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
  };
  const payload = useMemo(
    () => ({
      maximumUploadBytes: int(maxUploadMb, Math.round(cr.maximumUploadBytes / (1024 * 1024))) * 1024 * 1024,
      maximumDurationSeconds: int(maxSeconds, cr.maximumDurationSeconds),
      limits: { maxActiveJobsGlobal: int(maxGlobal, cr.limits.maxActiveJobsGlobal), maxActiveJobsPerUser: int(maxPerUser, cr.limits.maxActiveJobsPerUser) },
      processing: {
        queueEnabled,
        concurrency: { free: int(free, p.concurrency.free), pro: int(pro, p.concurrency.pro), business: int(business, p.concurrency.business), maxAi: int(maxAi, p.concurrency.maxAi), admin: int(admin, p.concurrency.admin) },
        maxVideosPerBatch: int(maxPerBatch, p.maxVideosPerBatch),
        autoRetryCount: int(retries, p.autoRetryCount),
        jobTimeoutMinutes: int(timeout, p.jobTimeoutMinutes),
        refundFailedJobs: refundFailed,
      } satisfies CharacterReplaceConfig["processing"],
    }),
    [admin, business, cr.limits.maxActiveJobsGlobal, cr.limits.maxActiveJobsPerUser, cr.maximumDurationSeconds, cr.maximumUploadBytes, free, maxAi, maxGlobal, maxPerBatch, maxPerUser, maxSeconds, maxUploadMb, p, pro, queueEnabled, refundFailed, retries, timeout],
  );

  /* The same bounds the server enforces, refused before the request leaves. */
  const problems = useMemo(() => {
    const out: string[] = [];
    const within = (label: string, v: number, min: number, max: number) => {
      if (v < min || v > max) out.push(`${label} must be between ${min} and ${max}.`);
    };
    const c = payload.processing.concurrency;
    within("Free concurrent videos", c.free, B.concurrency.min, B.concurrency.max);
    within("Pro concurrent videos", c.pro, B.concurrency.min, B.concurrency.max);
    within("Business concurrent videos", c.business, B.concurrency.min, B.concurrency.max);
    within("Max AI concurrent videos", c.maxAi, B.concurrency.min, B.concurrency.max);
    within("Administrator concurrent videos", c.admin, B.adminConcurrency.min, B.adminConcurrency.max);
    within("Videos per batch", payload.processing.maxVideosPerBatch, B.maxVideosPerBatch.min, B.maxVideosPerBatch.max);
    within("Automatic retries", payload.processing.autoRetryCount, B.autoRetryCount.min, B.autoRetryCount.max);
    within("Job timeout (minutes)", payload.processing.jobTimeoutMinutes, B.jobTimeoutMinutes.min, B.jobTimeoutMinutes.max);
    within("Platform-wide active videos", payload.limits.maxActiveJobsGlobal, 0, 10_000);
    within("Per-member cap override", payload.limits.maxActiveJobsPerUser, 0, 100);
    within("Largest upload (MB)", payload.maximumUploadBytes / (1024 * 1024), 1, 100);
    within("Longest video (seconds)", payload.maximumDurationSeconds, 1, 120);
    return out;
  }, [payload]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!payload.processing.queueEnabled) out.push("Queue off: a member at their cap is refused instead of waiting, and multi-video sessions are unavailable.");
    if (!payload.processing.refundFailedJobs) out.push("Failed-job refund off: a failed video keeps its charge reserved until you refund it by hand from the job monitor. Members are told nothing was delivered.");
    if (payload.limits.maxActiveJobsGlobal === 0) out.push("No platform-wide cap on active videos — a burst can run up the provider bill without a ceiling.");
    if (payload.limits.maxActiveJobsPerUser > 0) out.push(`The per-member override (${payload.limits.maxActiveJobsPerUser}) tightens every plan's figure below it.`);
    return out;
  }, [payload]);

  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frenzAiCharacterReplace: payload }),
      });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. Applies to the next start and the next admission from the queue." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Processing</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        How many videos one member may have running at once, what happens to the rest, and the ceilings every video is measured against. A member over their cap
        waits in their own line (paid for, started automatically) while the queue is on.
      </p>

      <div className="space-y-6">
        <Group title="Concurrent videos per member">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            Running at once — preparing, processing or finishing. Waiting videos are not counted. {B.concurrency.min}–{B.concurrency.max} per plan; administrators up to {B.adminConcurrency.max}.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Field id="cr-proc-free" label="Free"><input id="cr-proc-free" inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value)} className={input} /></Field>
            <Field id="cr-proc-pro" label="Pro"><input id="cr-proc-pro" inputMode="numeric" value={pro} onChange={(e) => setPro(e.target.value)} className={input} /></Field>
            <Field id="cr-proc-business" label="Business"><input id="cr-proc-business" inputMode="numeric" value={business} onChange={(e) => setBusiness(e.target.value)} className={input} /></Field>
            <Field id="cr-proc-maxai" label="Max AI"><input id="cr-proc-maxai" inputMode="numeric" value={maxAi} onChange={(e) => setMaxAi(e.target.value)} className={input} /></Field>
            <Field id="cr-proc-admin" label="Administrators" hint="Applies to an admin whatever their plan."><input id="cr-proc-admin" inputMode="numeric" value={admin} onChange={(e) => setAdmin(e.target.value)} className={input} /></Field>
          </div>
        </Group>

        <Group title="Platform & sessions">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="cr-proc-global" label="Active videos across FrenzSave" hint="0 = no cap. Counted inside the same lock as the member's cap.">
              <input id="cr-proc-global" inputMode="numeric" value={maxGlobal} onChange={(e) => setMaxGlobal(e.target.value)} className={input} />
            </Field>
            <Field id="cr-proc-per-user" label="Per-member cap override" hint="0 = each plan's own figure. A number here tightens every plan below it.">
              <input id="cr-proc-per-user" inputMode="numeric" value={maxPerUser} onChange={(e) => setMaxPerUser(e.target.value)} className={input} />
            </Field>
            <Field id="cr-proc-batch" label="Videos per batch" hint={`One submission, and the most a member may have waiting + running. ${B.maxVideosPerBatch.min}–${B.maxVideosPerBatch.max}.`}>
              <input id="cr-proc-batch" inputMode="numeric" value={maxPerBatch} onChange={(e) => setMaxPerBatch(e.target.value)} className={input} />
            </Field>
          </div>
        </Group>

        <Group title="Every video">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="cr-proc-upload" label="Largest upload (MB)" hint="The tool's ceiling; each replacement type may set a lower one on the Pricing tab.">
              <input id="cr-proc-upload" inputMode="numeric" value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} className={input} />
            </Field>
            <Field id="cr-proc-seconds" label="Longest video (seconds)" hint="1–120. In a batch every video runs at full length, so a longer one is refused at the picker.">
              <input id="cr-proc-seconds" inputMode="numeric" value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} className={input} />
            </Field>
          </div>
        </Group>

        <Group title="Queue, retries & refunds">
          <div className="space-y-4">
            <Toggle label="Queue" hint="On: a member over their cap waits in line and each video starts by itself when a slot frees. Off: the Part 8 refusal — one at a time, no batches." checked={queueEnabled} onChange={setQueueEnabled} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id="cr-proc-retries" label="Automatic retries" hint={`How many times the worker retries a finalization that failed for a transient reason before giving up and refunding. ${B.autoRetryCount.min}–${B.autoRetryCount.max}.`}>
                <input id="cr-proc-retries" inputMode="numeric" value={retries} onChange={(e) => setRetries(e.target.value)} className={input} />
              </Field>
              <Field id="cr-proc-timeout" label="Job timeout (minutes)" hint={`A video processing longer than this is ended and refunded. ${B.jobTimeoutMinutes.min}–${B.jobTimeoutMinutes.max}; the floor protects honest long runs.`}>
                <input id="cr-proc-timeout" inputMode="numeric" value={timeout} onChange={(e) => setTimeoutMinutes(e.target.value)} className={input} />
              </Field>
            </div>
            <Toggle label="Refund failed videos automatically" hint="On: a video that fails gives its charge (or complimentary creation) back at once. Off: the charge stays reserved for you to refund by hand from the job monitor. Cancelled videos always come back." checked={refundFailed} onChange={setRefundFailed} />
          </div>
        </Group>

        {problems.length ? (
          <ul className="space-y-1 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-xs text-rose-600">
            {problems.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {warnings.length ? (
          <ul className="space-y-1 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void submit()} disabled={busy || problems.length > 0} className={cn("btn-lux bg-foreground text-background", (busy || problems.length > 0) && "opacity-60")}>
            {busy ? "Saving…" : "Save processing settings"}
          </button>
          {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
        </div>
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/40 px-4 py-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
