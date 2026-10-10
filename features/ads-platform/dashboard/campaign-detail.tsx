"use client";

import { ArrowLeft, CalendarPlus, Loader2, Pause, Pencil, Play, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AiPanel } from "@/features/ai/design/ai-surface";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { adMessage } from "@/lib/ads-platform/messages";
import { specOf } from "@/lib/ads-platform/media-spec";
import { offeredDurations } from "@/lib/ads-platform/offer";
import { cn } from "@/lib/utils";

import { Chip, Notice, Row } from "../advertise-ui";
import { loadAdCatalog } from "../catalog-client";
import { prepareCreativeFile, waitForProcessing } from "../creative-prep";
import { DayChart, fromDay, PaymentList, Skeleton } from "../my-campaigns";
import { mediaTypeOf, posterFromVideo, putWithProgress } from "../upload-client";
import {
  byDay,
  date,
  liveCreative,
  loadCampaign,
  loadExtensions,
  loadHistory,
  loadPayments,
  loadStats,
  manage,
  num,
  pct,
  remaining,
  statusLabel,
  totalsOf,
  usd,
  type CampaignEvent,
  type CampaignRow,
  type ExtensionRow,
  type PaymentRow,
  type StatRow,
} from "./dashboard-data";
import { TestModeNote } from "./test-mode-note";

/**
 * One campaign: its creative, link and settings, its performance, its
 * payments and history — and only the actions its CURRENT state allows
 * (Part 6). Every action goes to the server, which re-checks ownership and
 * state; what is shown afterwards is the server's answer, re-read.
 *
 * The preview is a plain image / poster: it is not an ad view, sends no
 * event and touches no statistic.
 */

const EDITABLE = ["active", "paused", "paid", "validating"];
const HISTORY_TEXT: Record<string, string> = {
  activated: "Went live",
  campaign_started: "Started",
  resumed: "Resumed",
  resumed_by_advertiser: "You resumed it",
  paused: "Paused",
  creative_replaced: "New creative went live",
  creative_edited: "Details edited",
  extended: "Extended",
  extension_held: "Extension waiting on a check",
  extension_payment_started: "Extension payment started",
  paid: "Payment confirmed",
  payment_started: "Payment started",
  flagged: "Sent for a check",
  campaign_expired: "Ended",
  expired: "Ended",
  removed: "Removed by Frenzsave",
  rejected: "Not approved",
  awaiting_payment: "Ready for payment",
};

export function CampaignDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [c, setC] = useState<CampaignRow | null | "missing">(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    let alive = true;
    void loadCampaign(id).then((r) => alive && setC(r ?? "missing"));
    return () => {
      alive = false;
    };
  }, [id, n]);

  return (
    <div>
      <button type="button" onClick={onBack} className="inline-flex min-h-[2.5rem] items-center gap-1.5 text-[13.5px] font-semibold text-indigo-700 dark:text-indigo-300">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All campaigns
      </button>
      <div className="mt-2">
        {c === null ? <Skeleton /> : c === "missing" ? (
          // not yours, or not there — the same answer either way
          <AiPanel className="text-center">
            <p className="text-[15px] font-semibold">Campaign not found</p>
          </AiPanel>
        ) : (
          <Body c={c} reload={reload} />
        )}
      </div>
    </div>
  );
}

function Body({ c, reload }: { c: CampaignRow; reload: () => void }) {
  const l = statusLabel(c);
  const cr = liveCreative(c);
  const staged = c.ad_creatives.filter((x) => x.status === "staged").sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  const ended = !!c.end_at && Date.parse(c.end_at) <= Date.now();
  const blocked = cr?.validation_status === "blocked" || c.status === "removed";
  const editable = EDITABLE.includes(c.status) && !ended && !blocked;
  const [flash, setFlash] = useState<{ tone: "emerald" | "rose" | "amber"; text: string } | null>(null);

  return (
    <div className="space-y-4">
      <AiPanel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-brand text-[1.3rem] font-bold tracking-[-0.02em]">{c.name}</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{c.ad_placements?.name ?? "—"}</p>
          </div>
          <Chip tone={l.tone}>{l.text}</Chip>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,15rem)_1fr]">
          <Preview c={c} />
          <div>
            <Row label="Starts" value={date(c.start_at)} />
            <Row label="Ends" value={date(c.end_at)} />
            {c.status === "active" || c.status === "paused" ? <Row label="Remaining" value={remaining(c.end_at) ?? "—"} /> : null}
            <Row label="Payment" value={c.payment_verified_at ? `Paid · ${usd(c.total_amount_minor)}` : c.status === "payment_processing" ? "Processing" : "Not paid"} />
            <Row label="Link" value={cr?.destination_url ? <span className="break-all">{cr.destination_url}</span> : "—"} />
            {cr?.headline ? <Row label="Headline" value={cr.headline} /> : null}
            {cr?.description ? <Row label="Description" value={cr.description} /> : null}
          </div>
        </div>
        {staged && staged.validation_status === "pending" ? (
          <div className="mt-3"><Notice icon={Loader2} tone="indigo">A new creative is uploading or being checked. Your current ad keeps showing until it passes.</Notice></div>
        ) : null}
        {blocked ? <div className="mt-3"><Notice icon={Pause} tone="rose">Frenzsave stopped this ad. It can&apos;t be edited — please contact support.</Notice></div> : null}
        {c.status === "paused" && c.status_reason !== "advertiser_paused" ? <div className="mt-3"><Notice icon={Pause} tone="amber">Frenzsave paused this campaign. Our team will be in touch.</Notice></div> : null}
        {flash ? <div className="mt-3"><Notice icon={flash.tone === "emerald" ? Play : Pause} tone={flash.tone}>{flash.text}</Notice></div> : null}
      </AiPanel>

      {editable ? <Actions c={c} reload={reload} setFlash={setFlash} /> : null}
      {c.status === "draft" || c.status === "awaiting_payment" ? (
        <AiPanel>
          <p className="text-[14px] font-semibold">Finish this ad</p>
          <TapOnceLink href="/advertise/create" className="mt-2 inline-flex min-h-[2.75rem] items-center text-[13.5px] font-semibold text-indigo-700 dark:text-indigo-300">Continue →</TapOnceLink>
        </AiPanel>
      ) : null}
      {ended || c.status === "expired" ? (
        <AiPanel>
          <p className="text-[14px] font-semibold">This campaign has ended</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Ended campaigns can&apos;t be edited or extended. Create a new campaign to run this ad again.</p>
          <TapOnceLink href="/advertise/create" className="mt-2 inline-flex min-h-[2.75rem] items-center text-[13.5px] font-semibold text-indigo-700 dark:text-indigo-300">Create a new campaign →</TapOnceLink>
        </AiPanel>
      ) : null}

      <Performance id={c.id} />
      <Money id={c.id} />
      <History id={c.id} />
    </div>
  );
}

function Preview({ c }: { c: CampaignRow }) {
  const cr = liveCreative(c);
  const [play, setPlay] = useState(false);
  if (!cr?.media_url) return <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-muted text-[12.5px] text-muted-foreground">No creative yet</div>;
  return (
    <figure>
      {cr.media_type === "video" ? (
        play ? (
          // only when asked, and only this one; a preview records nothing
          <video src={cr.media_url} poster={cr.thumbnail_url ?? undefined} controls autoPlay muted playsInline preload="none" className="aspect-[16/10] w-full rounded-2xl bg-black object-contain" />
        ) : (
          <button type="button" onClick={() => setPlay(true)} className="relative block w-full" aria-label="Play preview">
            {cr.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN poster
              <img src={cr.thumbnail_url} alt="" className="aspect-[16/10] w-full rounded-2xl bg-muted object-cover" />
            ) : (
              <span className="block aspect-[16/10] w-full rounded-2xl bg-muted" />
            )}
            <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/60 p-3 text-white"><Play className="h-5 w-5" aria-hidden /></span></span>
          </button>
        )
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- CDN creative
        <img src={cr.media_url} alt={cr.headline ?? "Your ad"} className="aspect-[16/10] w-full rounded-2xl bg-muted object-contain" />
      )}
      <figcaption className="mt-1 text-[11.5px] text-muted-foreground">Preview — doesn&apos;t count as a view.</figcaption>
    </figure>
  );
}

/* ─────────────────────────────── actions ─────────────────────────────── */

type Flash = (f: { tone: "emerald" | "rose" | "amber"; text: string } | null) => void;

function Actions({ c, reload, setFlash }: { c: CampaignRow; reload: () => void; setFlash: Flash }) {
  const [open, setOpen] = useState<"details" | "replace" | "extend" | null>(null);
  const [busy, setBusy] = useState(false);
  const live = c.status === "active";
  const pausedByMe = c.status === "paused" && c.status_reason === "advertiser_paused";

  const toggle = async () => {
    setBusy(true);
    const r = await manage<{ status: string }>({ action: live ? "pause" : "resume", campaignId: c.id, version: c.version });
    setBusy(false);
    setFlash(r.ok ? { tone: "emerald", text: live ? "Paused. Resume any time before it ends." : r.data.status === "active" ? "Live again." : "Sent for a quick check." } : { tone: "rose", text: r.message });
    reload();
  };

  return (
    <AiPanel>
      <p className="text-[14px] font-semibold">Manage</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton icon={Upload} label="Replace image or video" active={open === "replace"} onClick={() => setOpen(open === "replace" ? null : "replace")} />
        <ActionButton icon={Pencil} label="Edit text & link" active={open === "details"} onClick={() => setOpen(open === "details" ? null : "details")} />
        {live || c.status === "paused" ? <ActionButton icon={CalendarPlus} label="Extend" active={open === "extend"} onClick={() => setOpen(open === "extend" ? null : "extend")} /> : null}
        {live || pausedByMe ? (
          <button type="button" disabled={busy} onClick={() => void toggle()} className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-semibold disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : live ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
            {busy ? (live ? "Pausing…" : "Resuming…") : live ? "Pause" : "Resume"}
          </button>
        ) : null}
      </div>
      {open === "details" ? <EditDetails c={c} done={(msg) => { setOpen(null); setFlash(msg); reload(); }} /> : null}
      {open === "replace" ? <Replace c={c} done={(msg) => { setOpen(null); setFlash(msg); reload(); }} /> : null}
      {open === "extend" ? <Extend c={c} /> : null}
    </AiPanel>
  );
}

function ActionButton({ icon: Icon, label, active, onClick }: { icon: typeof Upload; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={active} className={cn("inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold", active ? "bg-indigo-600 text-white" : "bg-secondary")}>
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </button>
  );
}

const input = "mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base sm:text-[14px]";

function EditDetails({ c, done }: { c: CampaignRow; done: Flash }) {
  const cr = liveCreative(c);
  const [headline, setHeadline] = useState(cr?.headline ?? "");
  const [description, setDescription] = useState(cr?.description ?? "");
  const [link, setLink] = useState(cr?.destination_url ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    // send only what changed; the server checks everything again
    const body: Record<string, unknown> = { action: "details", campaignId: c.id, version: c.version };
    if (headline !== (cr?.headline ?? "")) body.headline = headline;
    if (description !== (cr?.description ?? "")) body.description = description;
    if (link !== (cr?.destination_url ?? "")) body.destinationUrl = link;
    if (Object.keys(body).length === 3) return setErr(adMessage("nothing_to_change"));
    setBusy(true);
    const r = await manage<{ changed: string[] }>(body);
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    done({ tone: "emerald", text: "Saved. Your ad shows the new details now." });
  };
  return (
    <div className="mt-4 space-y-3">
      <label className="block text-[13px] font-semibold">Headline<input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={90} className={input} /></label>
      <label className="block text-[13px] font-semibold">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} rows={3} className={cn(input, "h-auto py-2")} /></label>
      <label className="block text-[13px] font-semibold">Link<input value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder="https://" className={input} /></label>
      <p className="text-[12px] text-muted-foreground">A new link is checked before it&apos;s used; until then your current link stays. Editing is free.</p>
      {err ? <p className="text-[13px] font-semibold text-rose-600">{err}</p> : null}
      <button type="button" disabled={busy} onClick={() => void save()} className="ai-btn ai-btn--primary inline-flex min-h-[2.75rem] items-center gap-1.5 disabled:opacity-70">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

function Replace({ c, done }: { c: CampaignRow; done: Flash }) {
  const [phase, setPhase] = useState<{ k: "idle" } | { k: "optimizing" } | { k: "uploading"; p: number } | { k: "checking" } | { k: "processing" } | { k: "error"; messages: string[] }>({ k: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);
  const pick = async (picked: File) => {
    const kind = mediaTypeOf(picked);
    if (!kind) return setPhase({ k: "error", messages: [adMessage("mime_not_allowed")] });
    // 0208: the same preparation as a new creative — the campaign's own format limits, from the cached catalog
    const cat = await loadAdCatalog().catch(() => null);
    const format = cat?.formats.find((x) => x.code === c.ad_placements?.format_code) ?? null;
    let file = picked;
    if (format) {
      const prepared = await prepareCreativeFile(picked, kind, specOf(format), () => setPhase({ k: "optimizing" }));
      if (!prepared.ok) return setPhase({ k: "error", messages: [adMessage(prepared.code)] });
      file = prepared.file;
    }
    const t = await manage<{ creativeId: string; uploadUrl: string; posterUploadUrl: string | null; version: number }>({ action: "replace-ticket", campaignId: c.id, mediaType: kind, mimeType: file.type, sizeBytes: file.size });
    if (!t.ok) return setPhase({ k: "error", messages: [t.message] });
    setPhase({ k: "uploading", p: 0 });
    if (kind === "video" && t.data.posterUploadUrl) {
      const poster = await posterFromVideo(file);
      if (poster) await putWithProgress({ url: t.data.posterUploadUrl, body: poster, contentType: poster.type || "image/webp" });
    }
    const ok = await putWithProgress({ url: t.data.uploadUrl, body: file, contentType: file.type, onProgress: (p) => setPhase({ k: "uploading", p }) });
    if (!ok) return setPhase({ k: "error", messages: [adMessage("upload_missing")] });
    setPhase({ k: "checking" });
    const f = await manage<{ ok: boolean; swapped: boolean; processing?: boolean; messages: string[] }>({ action: "replace-finalize", creativeId: t.data.creativeId, version: t.data.version });
    if (!f.ok) return setPhase({ k: "error", messages: [f.message] });
    if (f.data.ok && f.data.processing) {
      // 0208: an oversized video is being transcoded; the CURRENT ad keeps serving until it is ready and swapped in
      setPhase({ k: "processing" });
      const out = await waitForProcessing(t.data.creativeId, () => alive.current);
      if (out.state === "gone") return;
      if (out.state === "failed") return setPhase({ k: "error", messages: out.messages.length ? out.messages : [adMessage("processing_failed")] });
      if (out.state === "waiting") return done({ tone: "emerald", text: "Your new video is still being optimized. Your current ad stays live, and the new one replaces it automatically when it's ready." });
      return done({ tone: "emerald", text: "Your new video is optimized, passed the checks and is live." });
    }
    if (!f.data.ok || !f.data.swapped) return setPhase({ k: "error", messages: f.data.messages.length ? f.data.messages : [adMessage("not_ready")] });
    done({ tone: "emerald", text: "Your new creative passed the checks and is live." });
  };
  const working = phase.k === "optimizing" || phase.k === "uploading" || phase.k === "checking" || phase.k === "processing";
  return (
    <div className="mt-4">
      <p className="text-[13px] text-muted-foreground">Your current ad keeps showing while the new file uploads and is checked. It&apos;s replaced only if the new one passes — same campaign, same dates, no extra charge.</p>
      <input ref={inputRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov" className="sr-only" disabled={working} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      <button type="button" disabled={working} onClick={() => inputRef.current?.click()} className="ai-btn ai-btn--primary mt-3 inline-flex min-h-[2.75rem] items-center gap-1.5 disabled:opacity-70">
        {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
        {phase.k === "uploading"
          ? `Uploading… ${Math.round(phase.p * 100)}%`
          : phase.k === "checking"
            ? "Checking your file…"
            : phase.k === "optimizing"
              ? "Optimizing your image…"
              : phase.k === "processing"
                ? "Optimizing your video…"
                : "Choose a file"}
      </button>
      {phase.k === "error" ? (
        <div className="mt-3"><Notice icon={Pause} tone="rose">{phase.messages.join(" ")} Your current ad is still live.</Notice></div>
      ) : null}
    </div>
  );
}

function Extend({ c }: { c: CampaignRow }) {
  const [durations, setDurations] = useState<{ id: string; name: string; days: number }[] | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [quote, setQuote] = useState<{ quoteId: string; total: number; list: number; discountPercent: number; days: number; extraDays: number; newEndAt: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<"quote" | "pay" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void loadAdCatalog().then((cat) => {
      const ds = cat && c.ad_placements ? offeredDurations(cat, [c.ad_placements.code]) : [];
      setDurations(ds);
      if (ds[0]) setChoice(ds[0].id);
    });
  }, [c.ad_placements]);

  const getQuote = async () => {
    setErr(null);
    setQuote(null);
    setBusy("quote");
    const r = await manage<NonNullable<typeof quote>>({ action: "extend-quote", campaignId: c.id, durationId: choice });
    setBusy(null);
    if (!r.ok) return setErr(r.message);
    setQuote(r.data);
  };

  const pay = async () => {
    if (!quote) return;
    setBusy("pay");
    try {
      const res = await fetch("/api/ads/payment/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId: c.id, quoteId: quote.quoteId, extension: true }) });
      const d = (await res.json().catch(() => null)) as { url?: string; reference?: string; message?: string } | null;
      if (!res.ok || !d) throw new Error(d?.message ?? adMessage("server"));
      // the provider confirms the payment — never this page
      window.location.href = d.url ?? `/advertise/payment?reference=${encodeURIComponent(d.reference ?? "")}`;
    } catch (e) {
      setBusy(null);
      setErr(e instanceof Error ? e.message : adMessage("server"));
    }
  };

  if (!durations) return <div className="mt-4"><Skeleton /></div>;
  if (durations.length === 0) return <p className="mt-4 text-[13px] text-muted-foreground">Extensions aren&apos;t available for this placement right now.</p>;
  return (
    <div className="mt-4 space-y-3">
      <label className="block text-[13px] font-semibold">
        Add
        <select value={choice} onChange={(e) => { setChoice(e.target.value); setQuote(null); }} className={input}>
          {durations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      {!quote ? (
        <button type="button" disabled={busy !== null || !choice} onClick={() => void getQuote()} className="ai-btn ai-btn--primary inline-flex min-h-[2.75rem] items-center gap-1.5 disabled:opacity-70">
          {busy === "quote" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {busy === "quote" ? "Getting your price…" : "See the price"}
        </button>
      ) : (
        <div className="rounded-2xl bg-secondary/50 p-3.5">
          <Row label="Extra days" value={`${quote.days}${quote.extraDays ? ` + ${quote.extraDays} bonus` : ""}`} />
          <Row label="Ends now" value={date(c.end_at)} />
          <Row label="Ends after" value={date(quote.newEndAt)} strong />
          {quote.discountPercent > 0 ? <Row label="List price" value={usd(quote.list)} muted /> : null}
          <Row label="You pay" value={usd(quote.total)} strong />
          <p className="mt-1 text-[12px] text-muted-foreground">The end date moves once the payment is confirmed. Same campaign, same start, same place.</p>
          <button type="button" disabled={busy !== null} onClick={() => void pay()} className="ai-btn ai-btn--primary mt-3 inline-flex min-h-[2.75rem] items-center gap-1.5 disabled:opacity-70">
            {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} {busy === "pay" ? "Opening Secure Checkout…" : `Pay ${usd(quote.total)}`}
          </button>
        </div>
      )}
      {err ? <p className="text-[13px] font-semibold text-rose-600">{err}</p> : null}
    </div>
  );
}

/* ─────────────────────────────── performance / money / history ─────────────────────────────── */

function Performance({ id }: { id: string }) {
  const [range, setRange] = useState<number | null>(30);
  const [rows, setRows] = useState<StatRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    setRows(null);
    void loadStats([id], fromDay(range)).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [id, range]);
  const t = useMemo(() => (rows ? totalsOf(rows) : null), [rows]);
  return (
    <AiPanel>
      <TestModeNote campaignId={id} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-semibold">Performance</p>
        <div className="inline-flex gap-0.5 rounded-xl bg-secondary p-1">
          {[{ d: 7, l: "7 days" }, { d: 30, l: "30 days" }, { d: null, l: "Lifetime" }].map((o) => (
            <button key={o.l} type="button" onClick={() => setRange(o.d)} aria-pressed={range === o.d} className={cn("min-h-[2rem] rounded-lg px-2.5 text-[12px] font-semibold transition", range === o.d ? "bg-card text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground")}>{o.l}</button>
          ))}
        </div>
      </div>
      {!rows || !t ? <div className="mt-3"><Skeleton /></div> : (
        <>
          {/* 0201: conversions = details opened on Frenzsave; site visits = after the external-link warning */}
          <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-inset ring-border/70">
            {[
              { l: "Views", v: num(t.views) },
              { l: "Clicks", v: num(t.clicks) },
              { l: "CTR", v: pct(t.ctr) },
              { l: "Conversions", v: num(t.conversions) },
              { l: "Site visits", v: num(t.outbounds) },
              { l: "Video ends", v: num(t.videoCompletes + t.rewardCompletes) },
            ].map((k) => (
              <div key={k.l} className="min-w-0 bg-card px-3 py-3">
                <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{k.l}</p>
                <p className="mt-1.5 text-[1.2rem] font-semibold leading-none tracking-tight tabular-nums">{k.v}</p>
              </div>
            ))}
          </div>
          {t.videoPlays || t.rewardCompletes ? (
            <p className="mt-2 text-center text-[12px] text-muted-foreground">{num(t.videoPlays)} video plays · {num(t.videoCompletes + t.rewardCompletes)} watched to the end</p>
          ) : null}
          {/* Part 8: filtered traffic is disclosed as a total - never the rules or the evidence */}
          {t.filtered > 0 ? (
            <p className="mt-2 text-center text-[12px] text-muted-foreground">
              {num(t.filtered)} view{t.filtered === 1 ? "" : "s"} and clicks were filtered as invalid traffic and aren&apos;t counted.{" "}
              <TapOnceLink href="/advertise/rules#traffic-quality" className="font-semibold underline">How we count</TapOnceLink>
            </p>
          ) : null}
          <div className="mt-3"><DayChart rows={byDay(rows)} /></div>
        </>
      )}
    </AiPanel>
  );
}

function Money({ id }: { id: string }) {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [ext, setExt] = useState<ExtensionRow[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([loadPayments(0, 100), loadExtensions(id)]).then(([p, e]) => {
      if (!alive) return;
      setRows(p.filter((x) => x.campaign_id === id));
      setExt(e);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <AiPanel>
      <p className="text-[14px] font-semibold">Payments</p>
      <div className="mt-1">{rows ? <PaymentList rows={rows} /> : <Skeleton />}</div>
      {ext.length ? (
        <div className="mt-2 border-t border-border/60 pt-2">
          <p className="text-[12.5px] font-semibold text-muted-foreground">Extensions</p>
          <ul className="mt-1 space-y-1 text-[13px]">
            {ext.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>+{e.days + e.extra_days} days · {usd(e.total_minor)}</span>
                <span className="text-muted-foreground">{e.status === "applied" ? `Now ends ${date(e.new_end_at)}` : e.status === "held" ? "Being checked" : "Waiting for payment"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AiPanel>
  );
}

function History({ id }: { id: string }) {
  const [rows, setRows] = useState<CampaignEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadHistory(id).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!rows?.length) return null;
  return (
    <AiPanel>
      <p className="text-[14px] font-semibold">History</p>
      <ol className="mt-2 space-y-1.5 text-[13px]">
        {rows.map((e, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>{HISTORY_TEXT[e.kind] ?? e.kind.replace(/_/g, " ")}</span>
            <span className="shrink-0 text-muted-foreground">{new Date(e.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </li>
        ))}
      </ol>
    </AiPanel>
  );
}
