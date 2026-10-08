"use client";

import { ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, CircleAlert, Clock, FileCheck2, Gift, Globe, Info, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiButton } from "@/features/ai/design/ai-button";
import { AiPanel } from "@/features/ai/design/ai-surface";
import { useUser } from "@/features/auth/use-user";
import {
  APPLICATION_STATE_LABELS,
  APPLICATION_STEPS,
  applicationState,
  destinationHost,
  detailsProblems,
  normalizeDestination,
  STEP_LABELS,
  TEXT_LIMITS,
  type ApplicationStep,
} from "@/lib/ads-platform/application";
import type { CampaignStatus } from "@/lib/ads-platform/catalog";
import { checkDestinationUrl } from "@/lib/ads-platform/creative-validation";
import { adMessage } from "@/lib/ads-platform/messages";
import {
  bestPromotion,
  estimate,
  formatMoney,
  formatSpecs,
  fromPrice,
  maxPlacements,
  offeredDurations,
  offeredFormats,
  offeredPlacements,
  recommendedSize,
  type AdCatalog,
} from "@/lib/ads-platform/offer";
import { ADVERTISING_RULES, ADVERTISING_RULES_VERSION, AUTOMATED_VALIDATION_NOTICE, RULES_CHECKBOX_TEXT } from "@/lib/ads-platform/rules";
import { cn } from "@/lib/utils";

import { AdPreview } from "./ad-preview";
import { Chip, formatIcon, Notice, OptionCard, Row, Stepper, StepTitle } from "./advertise-ui";
import { loadAdCatalog } from "./catalog-client";
import { CreativeStep, type UploadedCreative } from "./creative-step";
import { loadMyApplications, type MyApplication } from "./my-applications-client";

/**
 * The advertiser application — eight steps on one page.
 *
 * The form lives HERE (and in sessionStorage, so a sign-in round trip or a
 * reload loses nothing). The server is called only at checkpoints: the upload
 * step (a draft is created so the file has a home), "Save draft", and
 * "Continue to Payment". No price, no menu, no validation is fetched per tap
 * or keystroke — the menu is one cached read of `ad_catalog`.
 */

const STORE = "frenz.advertise.form.v1";

interface Form {
  step: ApplicationStep;
  formatCode: string | null;
  placementCodes: string[];
  durationId: string | null;
  campaignId: string | null;
  savedKey: string | null;
  creative: UploadedCreative | null;
  name: string;
  businessName: string;
  headline: string;
  description: string;
  destination: string;
}

const EMPTY: Form = {
  step: "format",
  formatCode: null,
  placementCodes: [],
  durationId: null,
  campaignId: null,
  savedKey: null,
  creative: null,
  name: "",
  businessName: "",
  headline: "",
  description: "",
  destination: "",
};

function readStored(): Form | null {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Form>) } : null;
  } catch {
    return null;
  }
}

const choiceKey = (f: Pick<Form, "formatCode" | "placementCodes" | "durationId">) => JSON.stringify([f.formatCode, f.placementCodes, f.durationId]);

type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function api<T>(path: string, method: "POST" | "DELETE", body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
    if (!res.ok || !json) return { ok: false, code: json?.error ?? "server", message: json?.message ?? adMessage("server") };
    return { ok: true, data: json };
  } catch {
    return { ok: false, code: "network", message: "You appear to be offline. Please check your connection and try again." };
  }
}

/** Keep only choices the current catalog still sells. Returns the problems found. */
function reconcile(form: Form, cat: AdCatalog): { form: Form; notes: string[] } {
  const notes: string[] = [];
  const f = { ...form };
  if (f.formatCode && !offeredFormats(cat).some((x) => x.code === f.formatCode)) {
    notes.push(adMessage("format_unavailable"));
    return { form: { ...EMPTY, campaignId: f.campaignId, name: f.name, businessName: f.businessName }, notes };
  }
  if (f.formatCode) {
    const ok = new Set(offeredPlacements(cat, f.formatCode).map((p) => p.code));
    const kept = f.placementCodes.filter((c) => ok.has(c)).slice(0, maxPlacements(cat));
    if (kept.length !== f.placementCodes.length) notes.push(adMessage("placement_unavailable"));
    f.placementCodes = kept;
  }
  if (f.durationId && !offeredDurations(cat, f.placementCodes).some((d) => d.id === f.durationId)) {
    notes.push(adMessage("duration_unavailable"));
    f.durationId = null;
  }
  const order = APPLICATION_STEPS.indexOf(f.step);
  const firstGap = !f.formatCode ? 0 : f.placementCodes.length === 0 ? 1 : !f.durationId ? 2 : order;
  if (firstGap < order) f.step = APPLICATION_STEPS[firstGap]!;
  return { form: f, notes };
}

export function AdvertiseWizard() {
  const { user, loading: userLoading } = useUser();
  const [cat, setCat] = useState<AdCatalog | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [locked, setLocked] = useState<{ total: number; currency: string; quoteId: string; expiresAt: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [mine, setMine] = useState<MyApplication[] | null>(null);
  const [localPreview, setLocalPreview] = useState<{ src: string; mediaType: "image" | "video" } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // the menu (one cached read) and the saved form
  useEffect(() => {
    void loadAdCatalog().then((c) => {
      setCat(c);
      const stored = readStored();
      if (c && stored) {
        const r = reconcile(stored, c);
        setForm(r.form);
        setNotes(r.notes);
      }
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify(form));
    } catch {
      /* private mode: the form still works for this visit */
    }
  }, [form, hydrated]);

  // a signed-in member's own drafts (RLS read) — once
  useEffect(() => {
    if (!user || mine !== null) return;
    void loadMyApplications().then((r) => {
      setMine(r.applications);
      if (r.businessName) setForm((f) => (f.businessName ? f : { ...f, businessName: r.businessName! }));
    });
  }, [user, mine]);

  const update = useCallback((patch: Partial<Form>) => {
    setError(null);
    setLocked(null);
    setForm((f) => ({ ...f, ...patch }));
  }, []);

  const go = useCallback((step: ApplicationStep) => {
    setError(null);
    setForm((f) => ({ ...f, step }));
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);

  if (cat === undefined || !hydrated) return <WizardSkeleton />;
  if (cat === null || offeredFormats(cat).length === 0) return <Unavailable />;

  const format = cat.formats.find((f) => f.code === form.formatCode) ?? null;
  const placements = format ? offeredPlacements(cat, format.code) : [];
  const durations = offeredDurations(cat, form.placementCodes);
  const est = form.durationId ? estimate(cat, form.placementCodes, form.durationId) : null;
  const stepIndex = APPLICATION_STEPS.indexOf(form.step);
  const multi = maxPlacements(cat) > 1;
  const dest = normalizeDestination(form.destination);
  const destOk = checkDestinationUrl(dest).status === "valid";
  const host = destOk ? destinationHost(dest) : null;
  const problems = detailsProblems(form);

  /** Create or update the draft on the server — only when the choices changed. */
  const checkpoint = async (withDetails = false): Promise<string | null> => {
    const key = choiceKey(form);
    if (form.campaignId && form.savedKey === key && !withDetails) return form.campaignId;
    setBusy("save");
    const r = await api<{ campaignId: string }>("/api/ads/advertiser/draft", "POST", {
      campaignId: form.campaignId,
      formatCode: form.formatCode,
      placementCodes: form.placementCodes,
      durationId: form.durationId,
      name: form.name,
      businessName: form.businessName,
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      if (r.code === "not_found" || r.code === "not_editable") update({ campaignId: null, savedKey: null, creative: null });
      return null;
    }
    // a format change on the server removes the old creative - mirror it
    const formatChanged = form.campaignId && form.creative && form.savedKey && JSON.parse(form.savedKey)[0] !== form.formatCode;
    setForm((f) => ({ ...f, campaignId: r.data.campaignId, savedKey: key, creative: formatChanged ? null : f.creative }));
    setSavedAt(Date.now());
    return r.data.campaignId;
  };

  const next = async () => {
    const order = APPLICATION_STEPS;
    if (form.step === "duration" && user) {
      if (!(await checkpoint())) return;
    }
    go(order[Math.min(order.length - 1, stepIndex + 1)]!);
  };

  /**
   * "Continue to secure payment" — ONE tap: lock the price (a server quote),
   * then ask the server for the checkout the payment router chose, and go.
   * The button stays disabled from the first tap until the page leaves, so a
   * double tap can never open two payments (the server refuses a second one
   * too). The amount is never sent - only which campaign and which quote.
   */
  const pay = async () => {
    if (!form.campaignId || !rulesAccepted || busy) return;
    let quote = locked && Date.parse(locked.expiresAt) > Date.now() + 30_000 ? locked : null;
    if (!quote) {
      quote = await submit();
      if (!quote) return;
    }
    setBusy("pay");
    const r = await api<{ url?: string; verifying?: boolean; reference: string }>("/api/ads/payment/create", "POST", { campaignId: form.campaignId, quoteId: quote.quoteId });
    if (!r.ok) {
      setBusy(null);
      setError(r.code === "server" || r.code === "network" ? adMessage("payment_not_started") : r.message);
      if (r.code === "quote_expired" || r.code === "quote_invalid" || r.code === "not_payable") setLocked(null);
      return;
    }
    if (r.data.url) {
      window.location.assign(r.data.url);
      return; // stays busy: the page is leaving
    }
    window.location.assign(`/advertise/payment?reference=${encodeURIComponent(r.data.reference)}`);
  };

  const submit = async (): Promise<{ total: number; currency: string; quoteId: string; expiresAt: string } | null> => {
    if (!form.campaignId || !rulesAccepted) return null;
    if (!(await checkpoint(true))) return null;
    setBusy("submit");
    const r = await api<{ currency: string; total: number; quoteId: string; expiresAt: string }>("/api/ads/advertiser/submit", "POST", {
      campaignId: form.campaignId,
      name: form.name,
      businessName: form.businessName,
      headline: form.headline,
      description: form.description,
      destinationUrl: dest,
      rulesAccepted,
      rulesVersion: ADVERTISING_RULES_VERSION,
    });
    setBusy(null);
    if (!r.ok) {
      setError(r.message);
      if (r.code === "rules_outdated") setRulesAccepted(false);
      return null;
    }
    const q = { total: r.data.total, currency: r.data.currency, quoteId: r.data.quoteId, expiresAt: r.data.expiresAt };
    setLocked(q);
    return q;
  };

  const discard = async () => {
    if (form.campaignId) await api("/api/ads/advertiser/draft", "DELETE", { campaignId: form.campaignId });
    setForm(EMPTY);
    setLocalPreview(null);
    setRulesAccepted(false);
    setMine(null);
  };

  const resume = (a: MyApplication) => {
    const c = a.creative;
    const merged: Form = {
      ...EMPTY,
      step: c ? "details" : "creative",
      formatCode: a.formatCode,
      placementCodes: a.placementCodes,
      durationId: a.durationId,
      campaignId: a.id,
      savedKey: choiceKey({ formatCode: a.formatCode, placementCodes: a.placementCodes, durationId: a.durationId }),
      creative: c && c.media_url
        ? { id: c.id, mediaType: c.media_type, mediaUrl: c.media_url, thumbnailUrl: c.thumbnail_url, width: c.width, height: c.height, durationSeconds: c.duration_seconds === null ? null : Number(c.duration_seconds), sizeBytes: c.file_size_bytes }
        : null,
      name: a.name,
      businessName: form.businessName,
      headline: c?.headline ?? "",
      description: c?.description ?? "",
      destination: c?.destination_url ?? "",
    };
    const r = reconcile(merged, cat);
    setForm(r.form);
    setNotes(r.notes);
    setLocalPreview(null);
  };

  const canContinue: Record<ApplicationStep, boolean> = {
    format: !!format,
    placement: form.placementCodes.length > 0,
    duration: !!form.durationId && durations.some((d) => d.id === form.durationId),
    creative: !!form.creative,
    details: destOk && Object.keys(problems).length === 0,
    preview: true,
    rules: rulesAccepted,
    review: rulesAccepted,
  };

  const previewCreative = localPreview
    ? { src: localPreview.src, mediaType: localPreview.mediaType, durationSeconds: form.creative?.durationSeconds }
    : form.creative
      ? { src: form.creative.mediaUrl, mediaType: form.creative.mediaType, poster: form.creative.thumbnailUrl, durationSeconds: form.creative.durationSeconds }
      : null;

  return (
    <div ref={topRef} className="scroll-mt-20">
      <Stepper index={stepIndex} total={APPLICATION_STEPS.length} label={STEP_LABELS[form.step]} />

      {notes.length ? (
        <div className="mt-4 space-y-2">
          {notes.map((n) => (
            <Notice key={n} icon={Info} tone="amber">
              {n}
            </Notice>
          ))}
        </div>
      ) : null}

      {!cat.settings.applications_open ? (
        <div className="mt-4">
          <Notice icon={CalendarClock} tone="indigo">
            Advertising opens soon. You can prepare your ad now and save it as a draft.
          </Notice>
        </div>
      ) : null}

      {/* ── 1 · format ── */}
      {form.step === "format" ? (
        <section>
          {mine && mine.length > 0 ? <Drafts apps={mine} cat={cat} onResume={resume} /> : null}
          <StepTitle title="Choose your ad format" sub="How your ad appears on Frenzsave. You can preview it before you pay." />
          <div className="mt-4 space-y-2.5" role="radiogroup" aria-label="Ad format">
            {offeredFormats(cat).map((f) => {
              const from = fromPrice(cat, f.code);
              const card = (
                <OptionCard
                  key={f.code}
                  icon={formatIcon(f.code)}
                  title={f.name}
                  selected={form.formatCode === f.code}
                  onSelect={() =>
                    update(
                      form.formatCode === f.code
                        ? {}
                        : { formatCode: f.code, placementCodes: [], durationId: null, name: form.name || `${f.name} campaign` },
                    )
                  }
                  trailing={from !== null ? <span className="whitespace-nowrap text-[12px] font-semibold text-muted-foreground">from {formatMoney(from, cat.settings.display_currency)}</span> : null}
                >
                  {f.description}
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {formatSpecs(f).map((s) => (
                      <Chip key={s}>{s}</Chip>
                    ))}
                  </span>
                </OptionCard>
              );
              return form.formatCode === f.code ? (
                <div key={f.code} className="space-y-2.5">
                  {card}
                  <HowItLooks>
                    <AdPreview format={f} creative={null} sponsor="" headline="" description="" host={null} example compact />
                  </HowItLooks>
                </div>
              ) : (
                card
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── 2 · placement ── */}
      {form.step === "placement" && format ? (
        <section>
          <StepTitle
            title="Where should it appear?"
            sub={multi ? `Choose up to ${maxPlacements(cat)} places for your ${format.name.toLowerCase()}.` : `Choose where your ${format.name.toLowerCase()} appears.`}
          />
          <div className="mt-4 space-y-2.5" role={multi ? "group" : "radiogroup"} aria-label="Placement">
            {placements.map((p) => {
              const on = form.placementCodes.includes(p.code);
              const full = multi && !on && form.placementCodes.length >= maxPlacements(cat);
              return (
                <OptionCard
                  key={p.code}
                  multi={multi}
                  title={p.name}
                  selected={on}
                  disabled={full}
                  onSelect={() => {
                    const codes = multi ? (on ? form.placementCodes.filter((c) => c !== p.code) : [...form.placementCodes, p.code]) : [p.code];
                    const stillPriced = offeredDurations(cat, codes).some((d) => d.id === form.durationId);
                    update({ placementCodes: codes, durationId: stillPriced ? form.durationId : null });
                  }}
                >
                  {p.description}
                </OptionCard>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── 3 · duration ── */}
      {form.step === "duration" ? (
        <section>
          <StepTitle title="How long should it run?" sub="You're buying campaign time: your ad stays eligible to be shown for this many days." />
          <div className="mt-3">
            <Notice icon={Clock}>
              Campaign length isn&apos;t how long one ad stays on screen.{format?.rotation_seconds ? ` Banners rotate every ${format.rotation_seconds} seconds;` : ""} your campaign keeps running for the days you choose.
            </Notice>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-3" role="radiogroup" aria-label="Campaign duration">
            {durations.map((d) => {
              const on = form.durationId === d.id;
              const e = estimate(cat, form.placementCodes, d.id);
              const promo = form.placementCodes[0] ? bestPromotion(cat, form.placementCodes[0], d.id) : null;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => update({ durationId: d.id })}
                  className={cn(
                    "relative flex min-h-[6.5rem] flex-col items-start justify-between rounded-[1.3rem] bg-card p-3.5 text-left ring-1 ring-inset transition-[box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    on ? "ring-2 ring-indigo-500 shadow-[0_12px_30px_-20px_rgba(79,70,229,0.6)]" : "ring-black/[0.08] hover:ring-indigo-200",
                  )}
                >
                  <span className="text-[17px] font-bold tracking-[-0.02em]">{d.name}</span>
                  {promo && promo.extra_days > 0 ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-bold text-emerald-700">
                      <Gift className="h-3 w-3" aria-hidden /> +{promo.extra_days} bonus {promo.extra_days === 1 ? "day" : "days"}
                    </span>
                  ) : null}
                  {e ? (
                    <span className="mt-2 text-[13px] font-semibold tabular-nums text-muted-foreground">
                      {e.discount > 0 ? <s className="mr-1 font-normal opacity-70">{formatMoney(e.subtotal, e.currency)}</s> : null}
                      {formatMoney(e.total, e.currency)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {form.placementCodes[0] && form.durationId ? <PromoLine cat={cat} placement={form.placementCodes[0]} durationId={form.durationId} /> : null}
          {!userLoading && !user ? (
            <div className="mt-4">
              <Notice icon={LogIn}>Next you&apos;ll upload your creative. You&apos;ll need to sign in to your Frenzsave account for that — your choices are kept.</Notice>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── 4 · creative ── */}
      {form.step === "creative" && format ? (
        <section>
          <StepTitle title="Upload your creative" sub={format.recommendation ?? undefined} />
          {!user ? (
            <SignInCard />
          ) : (
            <CreativeStep
              format={format}
              current={form.creative}
              ensureDraft={() => checkpoint()}
              onUploaded={(c, local) => {
                update({ creative: c });
                setLocalPreview((old) => {
                  if (old) URL.revokeObjectURL(old.src);
                  return local;
                });
              }}
              recommended={recommendedSize(format)}
            />
          )}
          <div className="mt-5">
            <HowItLooks>
              {previewCreative ? (
                <AdPreview format={format} creative={previewCreative} sponsor={form.businessName} headline={form.headline} description={form.description} host={host} compact />
              ) : (
                <AdPreview format={format} creative={null} sponsor="" headline="" description="" host={null} example compact />
              )}
            </HowItLooks>
          </div>
        </section>
      ) : null}

      {/* ── 5 · details ── */}
      {form.step === "details" ? (
        <section>
          <StepTitle title="Where should people go?" sub="The page people reach when they tap your ad." />
          <div className="mt-4 space-y-4">
            <Field label="Destination URL" htmlFor="ad-dest" error={form.destination && !destOk ? adMessage("url_invalid") : null}>
              <input
                id="ad-dest"
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="https://yourbusiness.com"
                value={form.destination}
                onChange={(e) => update({ destination: e.target.value })}
                onBlur={() => form.destination && update({ destination: normalizeDestination(form.destination) })}
                className={inputClass}
              />
              {host ? (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-700">
                  <Globe className="h-3.5 w-3.5" aria-hidden /> Destination: {host}
                </p>
              ) : null}
            </Field>
            <Field label="Campaign name" htmlFor="ad-name" hint="Only you see this." error={form.name ? null : problems.name}>
              <input id="ad-name" value={form.name} maxLength={TEXT_LIMITS.name} onChange={(e) => update({ name: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Business or brand name" htmlFor="ad-brand" hint="Shown on your ad as “Sponsored · …”." error={form.businessName ? null : problems.businessName}>
              <input id="ad-brand" value={form.businessName} maxLength={TEXT_LIMITS.businessName} autoComplete="organization" onChange={(e) => update({ businessName: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Headline" htmlFor="ad-headline" hint="Optional" count={[form.headline.length, TEXT_LIMITS.headline]}>
              <input id="ad-headline" value={form.headline} maxLength={TEXT_LIMITS.headline} onChange={(e) => update({ headline: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Description" htmlFor="ad-desc" hint="Optional" count={[form.description.length, TEXT_LIMITS.description]}>
              <textarea id="ad-desc" rows={3} value={form.description} maxLength={TEXT_LIMITS.description} onChange={(e) => update({ description: e.target.value })} className={cn(inputClass, "h-auto resize-none py-3")} />
            </Field>
          </div>
        </section>
      ) : null}

      {/* ── 6 · preview ── */}
      {form.step === "preview" && format ? (
        <section>
          <StepTitle title="Preview your ad" sub="This is your real creative, at this format's real proportions." />
          <div className="mt-5">
            <AdPreview format={format} creative={previewCreative} sponsor={form.businessName} headline={form.headline} description={form.description} host={host} />
          </div>
          <p className="mt-4 text-center text-[12.5px] text-muted-foreground">Preview — actual placement may vary slightly by device.</p>
        </section>
      ) : null}

      {/* ── 7 · rules ── */}
      {form.step === "rules" ? (
        <section>
          <StepTitle title="Advertising Rules" sub="Every ad on Frenzsave follows these rules, so people can trust what they tap." />
          <AiPanel className="mt-4 divide-y divide-slate-100 p-0 sm:p-0">
            {ADVERTISING_RULES.map((r) => (
              <details key={r.id} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-semibold [&::-webkit-details-marker]:hidden">
                  {r.title}
                  <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{r.intro}</p>
                {r.items.length ? (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
                    {r.items.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                ) : null}
              </details>
            ))}
          </AiPanel>
          <Link href="/advertise/rules" target="_blank" rel="noopener" prefetch={false} className="mt-3 inline-flex min-h-[2.75rem] items-center gap-1.5 text-[13.5px] font-semibold text-indigo-700">
            View Advertising Rules <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <RulesCheckbox checked={rulesAccepted} onChange={setRulesAccepted} />
        </section>
      ) : null}

      {/* ── 8 · review ── */}
      {form.step === "review" && format ? (
        <section>
          <StepTitle title="Review and continue" sub="Check everything once more. The price is confirmed by our server when you continue." />
          <AiPanel className="mt-4">
            <Row label="Campaign" value={form.name} />
            <Row label="Format" value={format.name} />
            <Row label="Placement" value={form.placementCodes.map((c) => cat.placements.find((p) => p.code === c)?.name ?? c).join(", ")} />
            <Row label="Duration" value={cat.durations.find((d) => d.id === form.durationId)?.name ?? "—"} />
            <Row label="Creative" value={form.creative ? `${form.creative.mediaType === "video" ? "Video" : "Image"}${form.creative.width ? ` · ${form.creative.width} × ${form.creative.height}` : ""}${form.creative.durationSeconds ? ` · ${Math.round(form.creative.durationSeconds)} s` : ""}` : "—"} />
            <Row label="Destination" value={host ?? "—"} />
          </AiPanel>
          {est ? <PriceBreakdown cat={cat} est={est} durationName={cat.durations.find((d) => d.id === form.durationId)?.name ?? ""} /> : <div className="mt-3"><Notice icon={CircleAlert} tone="rose">{adMessage("no_price")}</Notice></div>}
          <div className="mt-3 flex items-center gap-2 text-[13.5px] font-semibold text-emerald-700">
            <BadgeCheck className="h-4 w-4" aria-hidden /> Advertising Rules {rulesAccepted ? "accepted" : "not accepted yet"}
          </div>
          <div className="mt-3">
            <Notice icon={ShieldCheck}>{AUTOMATED_VALIDATION_NOTICE}</Notice>
          </div>
          {locked ? (
            <AiPanel className="mt-4 ring-emerald-200">
              <p className="flex items-center gap-2 text-[15px] font-bold text-emerald-700">
                <FileCheck2 className="h-5 w-5" aria-hidden /> Price confirmed: {formatMoney(locked.total, locked.currency as AdCatalog["settings"]["display_currency"])}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Held for you until {new Date(locked.expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. You haven&apos;t been charged.
              </p>
            </AiPanel>
          ) : null}
          {busy === "submit" || busy === "pay" ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-indigo-700" role="status" aria-live="polite">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> {busy === "submit" ? "Preparing payment…" : "Opening secure checkout…"}
            </p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Notice icon={CircleAlert} tone="rose">
            {error}
          </Notice>
        </div>
      ) : null}

      {/* ── actions ── */}
      <div className="mt-6 flex items-center gap-2.5">
        {stepIndex > 0 ? (
          <AiButton variant="secondary" onClick={() => go(APPLICATION_STEPS[stepIndex - 1]!)} icon={<ArrowLeft className="h-4 w-4" />} aria-label="Back">
            Back
          </AiButton>
        ) : null}
        <div className="flex-1" />
        {form.step === "review" ? (
          <AiButton size="lg" onClick={() => void pay()} disabled={!rulesAccepted || !!busy || !est} aria-busy={busy === "submit" || busy === "pay"} iconEnd={busy === "submit" || busy === "pay" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}>
            Continue to secure payment
          </AiButton>
        ) : (
          <AiButton
            size="lg"
            onClick={() => void next()}
            disabled={!canContinue[form.step] || !!busy || (form.step === "creative" && !user)}
            iconEnd={busy === "save" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          >
            Continue
          </AiButton>
        )}
      </div>

      {est && stepIndex >= 2 && form.step !== "review" ? (
        <p className="mt-3 text-right text-[12.5px] text-muted-foreground">
          Estimated total <strong className="tabular-nums text-foreground">{formatMoney(est.total, est.currency)}</strong>
        </p>
      ) : null}

      {user && form.campaignId ? (
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-[12.5px] text-muted-foreground">
          <span>{savedAt ? "Draft saved" : "Saved as a draft"}</span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => void checkpoint(true)} disabled={!!busy} className="min-h-[2.75rem] px-2 font-semibold text-indigo-700">
              Save draft
            </button>
            <button type="button" onClick={() => void discard()} disabled={!!busy} className="min-h-[2.75rem] px-2 font-semibold text-rose-600">
              Discard
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

const inputClass =
  "h-12 w-full rounded-2xl bg-white px-4 text-[15px] ring-1 ring-inset ring-black/[0.1] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500";

function Field({ label, htmlFor, hint, error, count, children }: { label: string; htmlFor: string; hint?: string; error?: string | null; count?: [number, number]; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13.5px] font-semibold">
          {label}
          {hint ? <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span> : null}
        </label>
        {count ? <span className={cn("text-[11.5px] tabular-nums", count[0] > count[1] ? "text-rose-600" : "text-muted-foreground")}>{count[0]}/{count[1]}</span> : null}
      </div>
      {children}
      {error ? <p className="mt-1.5 text-[12.5px] font-medium text-rose-600">{error}</p> : null}
    </div>
  );
}

/** A quiet frame around a live preview, with its honest caption. */
function HowItLooks({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[1.4rem] bg-gradient-to-b from-slate-50 to-indigo-50/50 px-4 pb-3 pt-4 ring-1 ring-inset ring-slate-200/70">
      <p className="mb-3 text-center text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">How your ad will look</p>
      {children}
      <p className="mt-3 text-center text-[11.5px] text-muted-foreground">Preview — actual placement may vary slightly by device.</p>
    </div>
  );
}

function RulesCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("mt-4 flex cursor-pointer items-start gap-3 rounded-[1.3rem] p-4 ring-1 ring-inset transition-colors", checked ? "bg-indigo-50/60 ring-indigo-300" : "bg-card ring-black/[0.1]")}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600" />
      <span className="text-[13.5px] leading-relaxed">{RULES_CHECKBOX_TEXT}</span>
    </label>
  );
}

function PromoLine({ cat, placement, durationId }: { cat: AdCatalog; placement: string; durationId: string }) {
  const p = bestPromotion(cat, placement, durationId);
  if (!p) return null;
  const parts = [p.extra_days > 0 ? `+${p.extra_days} bonus ${p.extra_days === 1 ? "day" : "days"}` : null, p.discount_percent > 0 ? `${p.discount_percent}% off` : null].filter(Boolean);
  return (
    <div className="mt-3">
      <Notice icon={Gift} tone="emerald">
        <strong>{p.name}</strong> — {parts.join(" and ")}
        {p.ends_at ? ` · ends ${new Date(p.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
      </Notice>
    </div>
  );
}

function PriceBreakdown({ cat, est, durationName }: { cat: AdCatalog; est: NonNullable<ReturnType<typeof estimate>>; durationName: string }) {
  const promo = est.lines.find((l) => l.promotion)?.promotion ?? null;
  const extra = Math.max(0, ...est.lines.map((l) => l.extraDays));
  return (
    <AiPanel className="mt-3">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Price</p>
      <div className="mt-1">
        {est.lines.map((l) => (
          <Row key={l.placementCode} label={`${durationName} · ${cat.placements.find((p) => p.code === l.placementCode)?.name ?? l.placementCode}`} value={formatMoney(l.list, est.currency)} />
        ))}
        <Row label="Subtotal" value={formatMoney(est.subtotal, est.currency)} muted />
        {promo ? <Row label={`${promo.name}${extra ? ` · +${extra} bonus ${extra === 1 ? "day" : "days"}` : ""}`} value={est.discount > 0 ? `−${formatMoney(est.discount, est.currency)}` : "Included"} muted /> : null}
        <div className="border-t border-slate-100" />
        <Row label="Total" value={formatMoney(est.total, est.currency)} strong />
      </div>
    </AiPanel>
  );
}

function Drafts({ apps, cat, onResume }: { apps: MyApplication[]; cat: AdCatalog; onResume: (a: MyApplication) => void }) {
  return (
    <div className="mb-6 mt-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Continue where you left off</p>
      <div className="mt-2 space-y-2">
        {apps.slice(0, 4).map((a) => {
          const state = applicationState(a.status as CampaignStatus, a.creative ? [a.creative] : []);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onResume(a)}
              className="flex w-full items-center gap-3 rounded-[1.2rem] bg-card p-3 text-left ring-1 ring-inset ring-black/[0.08] hover:ring-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet-100 to-sky-100">
                {a.creative?.thumbnail_url || (a.creative?.media_type === "image" && a.creative.media_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small storage thumbnail
                  <img src={(a.creative.thumbnail_url || a.creative.media_url)!} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{a.name}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {cat.formats.find((f) => f.code === a.formatCode)?.name ?? "Ad"} · {APPLICATION_STATE_LABELS[state]}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SignInCard() {
  return (
    <AiPanel className="mt-4 text-center">
      <LogIn className="mx-auto h-6 w-6 text-indigo-600" aria-hidden />
      <p className="mt-2 text-[15px] font-semibold">Sign in to upload your creative</p>
      <p className="mt-1 text-[13px] text-muted-foreground">Use your Frenzsave account — the same one you use every day. Your choices so far are kept.</p>
      <Link href={`/login?next=${encodeURIComponent("/advertise/create")}`} prefetch={false} className="ai-btn ai-btn--primary mt-4 inline-flex">
        Sign in to continue
      </Link>
    </AiPanel>
  );
}

function Unavailable() {
  return (
    <AiPanel className="mt-2 text-center">
      <CalendarClock className="mx-auto h-6 w-6 text-indigo-600" aria-hidden />
      <p className="mt-2 text-[15px] font-semibold">Advertising isn&apos;t available right now</p>
      <p className="mt-1 text-[13px] text-muted-foreground">No ad formats are open for booking at the moment. Please check back soon.</p>
    </AiPanel>
  );
}

function WizardSkeleton() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="flex gap-1">
        {APPLICATION_STEPS.map((s) => (
          <span key={s} className="h-1 flex-1 rounded-full bg-slate-200" />
        ))}
      </div>
      <span className="mt-4 block h-7 w-2/3 rounded-full bg-slate-200" />
      <span className="mt-2 block h-4 w-1/2 rounded-full bg-slate-100" />
      {[0, 1, 2].map((i) => (
        <span key={i} className="mt-3 block h-24 rounded-[1.4rem] bg-slate-100" />
      ))}
    </div>
  );
}

