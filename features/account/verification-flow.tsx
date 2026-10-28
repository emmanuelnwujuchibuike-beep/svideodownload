"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/client";
// Types come from `verification-shared`, NOT `verification` — the latter is `server-only`.
import { VERIFICATION_CATEGORIES, type VerificationCategory, type VerificationState } from "@/lib/social/verification-shared";
import { cn } from "@/lib/utils";

/**
 * Verification — the member's side, as design/frenz-verification.html (owner, 2026-10-28).
 *
 *   0 Intro → 1 Who you are → 2 Selfie → 3 Review → 4 Payment (only when the admin has priced the tick)
 *   → Under review → Verified
 *
 * 🔴 No ID document step (owner: "don't add the ID step"). The design's Document screen is left out; the selfie and
 * the details are what the reviewer sees. Billing appears only at the last step, after everything else is done.
 *
 * The selfie goes straight to the PRIVATE `verification-docs` bucket from the browser (RLS keeps each member to their
 * own folder); only its path is submitted. With the paid tick on, the details are saved as a draft and go to review
 * once the payment is confirmed (lib/social/paid-verification.ts); the return from checkout is settled by the existing
 * PaidVerificationCard logic (`paidReturn`), never by this page's URL.
 *
 * Light: no animation library, CSS only, nothing runs while idle.
 */

const STEPS = ["Identity", "Selfie", "Review", "Payment"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

const TICK_PATH = "M12 1.8l2.6 1.9 3.2.1 1 3.1 2.5 1.9-1 3.1 1 3.1-2.5 1.9-1 3.1-3.2.1L12 22.2l-2.6-1.9-3.2-.1-1-3.1-2.5-1.9 1-3.1-1-3.1 2.5-1.9 1-3.1 3.2-.1z";
const OUT = "bg-frenz-card shadow-[0_1px_1px_rgba(16,24,40,.04),0_12px_30px_-8px_rgba(16,24,40,.14),0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[-6px_-6px_16px_rgba(255,255,255,.045),9px_11px_26px_rgba(0,0,0,.55)]";
const OUT_SM = "bg-frenz-card shadow-[0_1px_1px_rgba(16,24,40,.04),0_6px_14px_-4px_rgba(16,24,40,.13),0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[-4px_-4px_10px_rgba(255,255,255,.045),5px_6px_14px_rgba(0,0,0,.55)]";
const IN = "bg-frenz-fill shadow-[inset_0_2px_6px_rgba(16,24,40,.09),inset_0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[inset_5px_5px_11px_rgba(0,0,0,.55),inset_-5px_-5px_11px_rgba(255,255,255,.045)]";
const IN_SM = "bg-frenz-fill shadow-[inset_0_1px_4px_rgba(16,24,40,.09),inset_0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[inset_3px_3px_6px_rgba(0,0,0,.55),inset_-3px_-3px_6px_rgba(255,255,255,.045)]";
const BRAND = "bg-[linear-gradient(135deg,#3B5BFD_0%,#4F4BF0_55%,#7C3AED_100%)]";
const ACCENT = "text-[#2F5BEA] dark:text-[#7C9BFF]";
const INPUT = cn("h-[54px] w-full rounded-2xl border-0 px-4 text-base outline-none transition-shadow placeholder:text-frenz-muted focus:ring-2 focus:ring-[#2F5BEA] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-rose-600", IN);
const COUNTRIES = ["Nigeria", "Ghana", "Kenya", "South Africa", "United Kingdom", "United States", "Canada", "Other"];

const Tick = ({ size = 18, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
    <path d={TICK_PATH} fill="#2F6BFF" />
    <path d="M8 12.3l2.7 2.7L16.2 9.5" stroke="#fff" strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Check = ({ className }: { className?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const Cross = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="shrink-0 text-rose-600" role="img" aria-label="Avoid">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export interface PaidOffer {
  enabled: boolean;
  priceCents: number;
  periodDays: number;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function VerificationFlow({
  state,
  displayName,
  handle,
  avatarUrl,
  offer,
  paidUntil,
  paidReturn,
}: {
  state: VerificationState;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  offer: PaidOffer;
  paidUntil: string | null;
  /** the return from checkout (`?paid=`): the existing card settles it with the server */
  paidReturn: ReactNode;
}) {
  if (paidReturn) return <Frame title="Verification" sub="Confirming your payment">{paidReturn}</Frame>;
  if (state.verified) return <Approved name={state.request?.legalName ?? displayName} handle={handle} avatarUrl={avatarUrl} paidUntil={paidUntil} />;
  if (state.request && (state.request.status === "pending" || state.request.status === "in_review")) {
    return <Submitted submittedAt={state.request.submittedAt} paid={offer.enabled} periodDays={offer.periodDays} />;
  }
  return <Apply handle={handle} avatarUrl={avatarUrl} offer={offer} rejected={state.request?.status === "rejected" ? state.request.decisionReason : null} />;
}

/* ───────────────────────────── chrome ───────────────────────────── */

function Frame({ title, sub, step, onBack, children, cta }: { title: string; sub: string; step?: number; onBack?: () => void; children: ReactNode; cta?: ReactNode }) {
  return (
    <div className="frenz-ui mx-auto flex min-h-[100dvh] max-w-[520px] flex-col bg-frenz-page text-frenz-ink">
      <header className="sticky top-0 z-20 border-b border-frenz-line bg-frenz-page/80 px-4 pb-3 pt-[calc(10px+var(--frenz-safe-top))] backdrop-blur-[22px] backdrop-saturate-[1.8]">
        <div className="flex items-center gap-3">
          {onBack ? (
            <button type="button" onClick={onBack} aria-label="Back" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] active:shadow-none", OUT_SM)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            </button>
          ) : (
            <Link href="/account" aria-label="Back to settings" className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px]", OUT_SM)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-extrabold tracking-[-0.5px]">{title}</h1>
            <p className="mt-px text-[13px] text-frenz-muted">{sub}</p>
          </div>
        </div>
        {step !== undefined ? (
          <nav aria-label="Progress">
            <ol className="mt-3 grid grid-cols-4 gap-1.5">
              {STEPS.map((label, i) => {
                const n = i + 1;
                const state = n < step ? "done" : n === step ? "now" : "";
                return (
                  <li key={label} aria-current={state === "now" ? "step" : undefined}>
                    <div className={cn("h-[5px] overflow-hidden rounded-[3px]", IN_SM)}>
                      <i className={cn("block h-full rounded-[3px] transition-[width] duration-500", BRAND, state ? "w-full" : "w-0")} />
                    </div>
                    <span className={cn("mt-1.5 block truncate text-center text-[11px] font-semibold", state ? ACCENT : "text-frenz-muted")}>{label}</span>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
      </header>
      <main className="flex-1 px-4 pb-[calc(130px+env(safe-area-inset-bottom))] pt-[22px]">{children}</main>
      {cta ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-frenz-line bg-frenz-page/80 px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 backdrop-blur-[22px] backdrop-saturate-[1.8]">
          <div className="mx-auto flex max-w-[488px] items-center gap-3">{cta}</div>
        </div>
      ) : null}
    </div>
  );
}

function Primary({ children, onClick, busy, disabled }: { children: ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
      className={cn("inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-[18px] px-[22px] text-[17px] font-bold tracking-[-0.2px] text-white shadow-[0_12px_24px_rgba(59,91,253,.32),inset_0_1px_0_rgba(255,255,255,.3)] transition active:translate-y-px active:scale-[0.99]", BRAND, disabled && "opacity-45 shadow-none")}
    >
      {busy ? <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-[2.5px] border-white/35 border-t-white" /> : null}
      {children}
    </button>
  );
}

const Eyebrow = ({ children }: { children: ReactNode }) => <p className="text-xs font-extrabold uppercase tracking-[1.2px] text-frenz-muted">{children}</p>;
const H2 = ({ children, id }: { children: ReactNode; id?: string }) => <h2 id={id} className="mt-1.5 text-[28px] font-extrabold leading-[1.12] tracking-[-0.7px]">{children}</h2>;
const Lede = ({ children }: { children: ReactNode }) => <p className="mt-2 text-base leading-normal text-frenz-muted">{children}</p>;
const Label = ({ children, id }: { children: ReactNode; id?: string }) => <p id={id} className="mx-1 mb-2.5 mt-[26px] text-[13px] font-bold text-frenz-muted">{children}</p>;
const Err = ({ show, children, id }: { show: boolean; children: ReactNode; id?: string }) => (show ? <p id={id} role="alert" className="mx-1 mt-1.5 text-[12.5px] font-semibold text-rose-600">{children}</p> : null);

function Avatar({ url, size = 36 }: { url: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover shadow-[0_0_0_2px_var(--frenz-card-color,#fff),0_0_0_3.5px_#7C3AED]" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="shrink-0 rounded-full bg-[linear-gradient(135deg,#C7B9A6,#7C6A55)]" style={{ width: size, height: size }} />
  );
}

/* ───────────────────────────── the application ───────────────────────────── */

function Apply({ handle, avatarUrl, offer, rejected }: { handle: string | null; avatarUrl: string | null; offer: PaidOffer; rejected: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [cat, setCat] = useState<VerificationCategory | null>(null);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [country, setCountry] = useState("");
  const [org, setOrg] = useState("");
  const [links, setLinks] = useState("");
  const [selfie, setSelfie] = useState<{ path: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [errs, setErrs] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const headingRef = useRef<HTMLDivElement>(null);
  const paid = offer.enabled;
  const lastStep: Step = paid ? 4 : 3;
  const categories = VERIFICATION_CATEGORIES.filter((c) => ["creator", "business", "public_figure", "journalist"].includes(c.value));

  useEffect(() => () => {
    if (selfie?.preview.startsWith("blob:")) URL.revokeObjectURL(selfie.preview);
  }, [selfie]);

  const go = (n: Step) => {
    setStep(n);
    setProblem(null);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    requestAnimationFrame(() => headingRef.current?.querySelector("h2")?.focus({ preventScroll: true }));
  };
  const refuse = () => {
    setShake((k) => k + 1);
    navigator.vibrate?.([12, 40, 12]);
  };

  const validIdentity = () => {
    const d = new Date(`${dob}T00:00:00`);
    const next = {
      cat: !cat,
      name: name.trim().split(/\s+/).filter(Boolean).length < 2,
      dob: !dob || Number.isNaN(d.getTime()) || d > new Date() || d.getFullYear() < 1900,
      country: !country,
      org: (cat === "business" || cat === "journalist") && !org.trim(),
    };
    setErrs(next);
    return !Object.values(next).some(Boolean);
  };

  const pickSelfie = async (file: File) => {
    setUploading(true);
    setProblem(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again.");
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${user.id}/selfie-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("verification-docs").upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
      if (error) throw new Error("The photo didn't upload. Try again.");
      if (selfie?.preview.startsWith("blob:")) URL.revokeObjectURL(selfie.preview);
      setSelfie({ path, preview: URL.createObjectURL(file) });
      setErrs((e) => ({ ...e, selfie: false }));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The photo didn't upload.");
    } finally {
      setUploading(false);
    }
  };

  const save = async (): Promise<boolean> => {
    const res = await fetch("/api/verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: cat, legalName: name.trim(), dateOfBirth: dob, country, organization: org.trim() || null, links: links.trim() || null, selfiePath: selfie?.path }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res?.ok || !json?.ok) {
      setProblem(json?.error ?? "Couldn't reach the server. Try again.");
      return false;
    }
    return true;
  };

  const next = async () => {
    if (busy) return;
    if (step === 1 && !validIdentity()) return refuse();
    if (step === 2 && !selfie) {
      setErrs((e) => ({ ...e, selfie: true }));
      return refuse();
    }
    if (step === 3 && !consent) {
      setErrs((e) => ({ ...e, consent: true }));
      return refuse();
    }
    if (step === 3 && !paid) {
      setBusy(true);
      if (await save()) router.refresh();
      setBusy(false);
      return;
    }
    if (step === 4) {
      setBusy(true);
      // the details first (saved as a draft until the payment is confirmed), then the existing secure checkout
      if (!(await save())) return setBusy(false);
      const res = await fetch("/api/verification/paid", { method: "POST" }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (json?.ok && json.url) {
        window.location.href = json.url;
        return;
      }
      setProblem(json?.error ?? "Couldn't open the checkout. Try again.");
      setBusy(false);
      return;
    }
    go((step + 1) as Step);
  };

  const labels: Record<Step, string> = { 0: "Start verification", 1: "Continue", 2: "Continue", 3: paid ? "Continue to payment" : "Submit for review", 4: busy ? "Opening secure checkout…" : `Pay ${money(offer.priceCents)}` };
  const meta = step === 0 ? (
    <><b className="block text-[15px] text-frenz-ink">3 min</b>to finish</>
  ) : (
    <><b className="block text-[15px] text-frenz-ink">{step} of {lastStep}</b>{step === lastStep ? "last step" : "steps"}</>
  );
  const catLabel = categories.find((c) => c.value === cat)?.label ?? "";
  const stepName = ["Get the blue tick", "Identity", "Selfie", "Review", "Payment"][step]!;

  return (
    <Frame
      title="Verification"
      sub={stepName}
      step={step >= 1 ? step : undefined}
      onBack={step > 0 ? () => go((step - 1) as Step) : undefined}
      cta={
        <>
          <div className="min-w-[68px] shrink-0 text-[13px] text-frenz-muted">{meta}</div>
          <span key={shake} className={cn("flex flex-1", shake && "motion-safe:animate-[vshake_0.32s_cubic-bezier(.2,.8,.2,1)]")}>
            <Primary onClick={() => void next()} busy={busy || uploading}>{labels[step]}</Primary>
          </span>
        </>
      }
    >
      <style>{`@keyframes vshake{20%{transform:translateX(-7px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(2px)}}`}</style>
      <div ref={headingRef} key={step} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
        {problem ? <p role="alert" className="mb-4 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-700 dark:text-rose-300">{problem}</p> : null}

        {step === 0 ? (
          <section aria-labelledby="v0">
            {rejected ? <p className="mb-4 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">Your last application wasn&apos;t approved{rejected ? `: ${rejected}` : "."} You can apply again.</p> : null}
            <div className={cn("relative mt-1 overflow-hidden rounded-[30px] px-5 pb-[22px] pt-[26px] text-center", OUT)}>
              <span aria-hidden className="pointer-events-none absolute inset-x-[-20%] top-[-40%] h-[260px] bg-[radial-gradient(closest-side,rgba(47,107,255,.14),transparent)]" />
              <div className={cn("relative mx-auto flex h-[104px] w-[104px] items-center justify-center rounded-[34px]", IN)}>
                <Tick size={58} className="drop-shadow-[0_8px_16px_rgba(47,107,255,.35)]" />
              </div>
              <H2 id="v0">
                <span tabIndex={-1} className="mt-[18px] block outline-none">Get the blue tick</span>
              </H2>
              <p className="mx-auto mt-2 max-w-[32ch] text-base leading-normal text-frenz-muted">Show people it&apos;s really you. Verify your identity in about three minutes.</p>
            </div>
            <div className="mt-4 grid gap-2.5">
              {[
                ["A badge people trust", "The blue tick shows on your profile, posts and chats.", <path key="a" d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6zM9 12l2 2 4-4" />],
                ["Harder to impersonate", "Followers can tell your account from copycats.", <path key="b" d="M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7M2.5 20a6.5 6.5 0 0 1 11.4-4.3M17 14l4 4M21 14l-4 4" />],
                ["Built for creators and brands", "Stand out in search, Explore and gifting.", <path key="c" d="M5 20V10M10 20V4M15 20v-7M20 20v-4" />],
              ].map(([t, d, p]) => (
                <div key={t as string} className={cn("flex items-start gap-3 rounded-[20px] p-3.5", OUT_SM)}>
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px]", IN_SM, ACCENT)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p}</svg>
                  </span>
                  <span><b className="block text-[15px]">{t}</b><span className="mt-0.5 block text-[13.5px] leading-snug text-frenz-muted">{d}</span></span>
                </div>
              ))}
            </div>
            <Label>What you&apos;ll need</Label>
            <div className="grid grid-cols-2 gap-2.5">
              <div className={cn("rounded-[18px] px-2.5 py-3.5 text-center", IN_SM)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={cn("mx-auto", ACCENT)} aria-hidden><circle cx="12" cy="9" r="4" /><path d="M4.5 20.5c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5" /></svg>
                <b className="mt-2 block text-[13.5px]">A selfie</b><span className="mt-0.5 block text-xs text-frenz-muted">Good light, no hat</span>
              </div>
              <div className={cn("rounded-[18px] px-2.5 py-3.5 text-center", IN_SM)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={cn("mx-auto", ACCENT)} aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
                <b className="mt-2 block text-[13.5px]">3 minutes</b><span className="mt-0.5 block text-xs text-frenz-muted">{paid ? "Payment comes last" : "No payment"}</span>
              </div>
            </div>
            <div className={cn("mt-4 flex items-start gap-2.5 rounded-[18px] p-3.5 text-[13px] leading-normal text-frenz-muted", IN)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg>
              <span>Your selfie and details are stored privately and are seen only by the reviewer handling your application. <Link href="/privacy" className={cn("font-semibold", ACCENT)}>How we protect your data</Link></span>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby="v1">
            <Eyebrow>Step 1 of {lastStep}</Eyebrow>
            <H2><span id="v1" tabIndex={-1} className="outline-none">Who you are</span></H2>
            <Lede>Use your real name, as people and official records know you.</Lede>
            <Label id="v-cat">Account type</Label>
            <div role="radiogroup" aria-labelledby="v-cat" className="grid gap-2.5">
              {categories.map((c) => {
                const on = cat === c.value;
                return (
                  <label key={c.value} className={cn("relative flex cursor-pointer items-center gap-3.5 rounded-[20px] px-4 py-3.5 transition", on ? cn(IN_SM, "ring-[1.5px] ring-[#2F5BEA]") : OUT_SM)}>
                    <input type="radio" name="cat" value={c.value} checked={on} onChange={() => { setCat(c.value); setErrs((e) => ({ ...e, cat: false })); }} className="peer absolute opacity-0" />
                    <span><b className="block text-base">{c.label}</b><small className="mt-0.5 block text-[13.5px] leading-snug text-frenz-muted">{c.blurb}</small></span>
                    <span aria-hidden className={cn("ml-auto flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full", IN_SM)}>
                      <span className={cn("h-3 w-3 rounded-full transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]", BRAND, on ? "scale-100" : "scale-0")} />
                    </span>
                  </label>
                );
              })}
            </div>
            <Err show={!!errs.cat}>Choose the account type that fits you best.</Err>

            <Label>Your details</Label>
            <div className={cn("rounded-3xl p-4", OUT)}>
              <div className={cn("flex items-center gap-2.5 rounded-2xl px-3.5 py-3 text-[15px]", IN_SM)}>
                <Avatar url={avatarUrl} />
                <span><span className="block text-[12.5px] text-frenz-muted">Verifying</span><b>{handle ? `@${handle}` : "your account"}</b></span>
              </div>
              <Field id="v-name" label="Full legal name" error={errs.name ? "Enter your first and last name." : null}>
                <input id="v-name" autoComplete="name" placeholder="Your first and last name" value={name} aria-invalid={!!errs.name} onChange={(e) => { setName(e.target.value); setErrs((x) => ({ ...x, name: false })); }} className={INPUT} />
              </Field>
              <Field id="v-dob" label="Date of birth" error={errs.dob ? "Enter a valid date of birth." : null}>
                <input id="v-dob" type="date" autoComplete="bday" value={dob} aria-invalid={!!errs.dob} onChange={(e) => { setDob(e.target.value); setErrs((x) => ({ ...x, dob: false })); }} className={INPUT} />
              </Field>
              <Field id="v-country" label="Country of residence" error={errs.country ? "Select your country." : null}>
                <select id="v-country" autoComplete="country-name" value={country} aria-invalid={!!errs.country} onChange={(e) => { setCountry(e.target.value); setErrs((x) => ({ ...x, country: false })); }} className={cn(INPUT, "appearance-none")}>
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              {cat === "business" || cat === "journalist" ? (
                <Field id="v-org" label={cat === "business" ? "Registered company name" : "Publication"} error={errs.org ? (cat === "business" ? "Enter the company name." : "Enter where you report.") : null}>
                  <input id="v-org" autoComplete={cat === "business" ? "organization" : "off"} placeholder={cat === "business" ? "e.g. Frenz Media Ltd" : "Where you report"} value={org} aria-invalid={!!errs.org} onChange={(e) => { setOrg(e.target.value); setErrs((x) => ({ ...x, org: false })); }} className={INPUT} />
                </Field>
              ) : null}
              <Field id="v-links" label={<>Links that show it&apos;s you <span className="font-medium text-frenz-muted">(optional)</span></>} hint="Helps reviewers confirm notability.">
                <input id="v-links" inputMode="url" placeholder="Website, articles or other profiles" value={links} onChange={(e) => setLinks(e.target.value)} className={INPUT} />
              </Field>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="v2">
            <Eyebrow>Step 2 of {lastStep}</Eyebrow>
            <H2><span id="v2" tabIndex={-1} className="outline-none">Take a selfie</span></H2>
            <Lede>A reviewer compares it with your profile to make sure it&apos;s you.</Lede>
            <div className={cn("relative mx-auto mt-[22px] flex h-[236px] w-[236px] items-center justify-center overflow-hidden rounded-full", IN)}>
              {selfie ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selfie.preview} alt="Your selfie preview" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <svg width="120" height="140" viewBox="0 0 24 28" fill="none" stroke="#2F5BEA" strokeWidth="1.3" strokeLinecap="round" className="opacity-45" aria-hidden><ellipse cx="12" cy="11" rx="6.5" ry="8" /><path d="M2 27c1.5-4.5 5.5-7 10-7s8.5 2.5 10 7" /></svg>
              )}
              <span aria-hidden className={cn("absolute inset-3.5 rounded-full border-[2.5px]", selfie ? "border-solid border-emerald-600" : "border-dashed border-[#2F5BEA]/45")} />
            </div>
            <label className={cn("relative mx-auto mt-[18px] flex h-14 w-max cursor-pointer items-center gap-2 overflow-hidden rounded-[18px] px-[22px] text-[17px] font-bold", OUT_SM, ACCENT)}>
              <input type="file" accept="image/*" capture="user" aria-describedby="v-selfie-err" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickSelfie(f); e.target.value = ""; }} className="absolute inset-0 cursor-pointer opacity-0" />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.6" /></svg>
              {uploading ? "Uploading…" : selfie ? "Retake selfie" : "Open camera"}
            </label>
            <div className="text-center"><Err id="v-selfie-err" show={!!errs.selfie}>Take a selfie to continue.</Err></div>
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              {[["Face the light", true], ["Face inside the circle", true], ["Sunglasses or a hat", false], ["Filters or edits", false]].map(([t, ok]) => (
                <div key={t as string} className={cn("flex items-center gap-2 rounded-[14px] px-3 py-2.5 text-[13px] font-semibold", OUT_SM, !ok && "text-frenz-muted")}>
                  {ok ? <Check className="shrink-0 text-emerald-700 dark:text-emerald-400" /> : <Cross />}
                  {t}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section aria-labelledby="v3">
            <Eyebrow>Step 3 of {lastStep}</Eyebrow>
            <H2><span id="v3" tabIndex={-1} className="outline-none">Check your details</span></H2>
            <Lede>Make sure everything is right before you continue.</Lede>
            <div className={cn("mt-4 rounded-3xl p-4", OUT)}>
              <Row k="Account type" v={catLabel} onEdit={() => go(1)} first />
              <Row k="Full legal name" v={name.trim()} onEdit={() => go(1)} />
              <Row k="Date of birth" v={dob ? new Date(`${dob}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : ""} onEdit={() => go(1)} />
              <Row k="Country" v={country} onEdit={() => go(1)} />
              {org.trim() && (cat === "business" || cat === "journalist") ? <Row k={cat === "business" ? "Company" : "Publication"} v={org.trim()} onEdit={() => go(1)} /> : null}
              {selfie ? (
                <div className="flex items-center gap-3 border-t border-frenz-line py-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-frenz-muted">Selfie</div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={selfie.preview} alt="Selfie" className="mt-1.5 h-[42px] w-[42px] rounded-full object-cover shadow-sm" />
                  </div>
                  <button type="button" onClick={() => go(2)} className={cn("px-1 py-2 text-sm font-semibold", ACCENT)}>Edit</button>
                </div>
              ) : null}
            </div>
            <label className={cn("relative mt-3.5 flex cursor-pointer items-start gap-3 rounded-[18px] p-3.5 text-sm leading-[1.45] text-frenz-muted", OUT_SM)}>
              <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrs((x) => ({ ...x, consent: false })); }} aria-describedby="v-consent-err" className="absolute opacity-0" />
              <span aria-hidden className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition", consent ? BRAND : IN_SM)}>
                {consent ? <Check className="text-white" /> : null}
              </span>
              <span>
                I confirm these details are true and agree that Frenz may use my selfie and details to verify my identity, as described in the <Link href="/terms" className={cn("font-semibold", ACCENT)}>Terms</Link> and <Link href="/privacy" className={cn("font-semibold", ACCENT)}>Privacy policy</Link>.
              </span>
            </label>
            <Err id="v-consent-err" show={!!errs.consent}>Please confirm to continue.</Err>
          </section>
        ) : null}

        {step === 4 ? (
          <section aria-labelledby="v4">
            <Eyebrow>Step 4 of 4</Eyebrow>
            <H2><span id="v4" tabIndex={-1} className="outline-none">Activate your blue tick</span></H2>
            <Lede>Your details are ready. Complete payment to submit them for review.</Lede>
            <div className="relative mt-[18px] overflow-hidden rounded-[26px] bg-[linear-gradient(150deg,#0F1A44_0%,#1B2C7A_55%,#3B2A9A_100%)] p-5 text-white shadow-[0_22px_44px_rgba(20,30,90,.28),inset_0_1px_0_rgba(255,255,255,.14)]">
              <span aria-hidden className="absolute -right-[70px] -top-[90px] h-[260px] w-[260px] rounded-full bg-[radial-gradient(circle,rgba(96,140,255,.55),transparent_70%)]" />
              <div className="relative flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.22] bg-white/[0.14]"><Tick size={26} /></span>
                <span><b className="block text-[17px]">Frenz Verified</b><span className="mt-px block text-[13px] text-white/[0.78]">{catLabel || "Creator"} account</span></span>
              </div>
              <div className="relative mt-[18px] flex items-baseline gap-1.5">
                <strong className="text-[46px] font-extrabold tabular-nums tracking-[-1.5px]">{money(offer.priceCents)}</strong>
                <span className="text-[15px] text-white/80">{offer.periodDays > 0 ? `/ ${offer.periodDays} days` : "one time"}</span>
              </div>
              <ul className="relative mt-3.5 grid gap-[9px] border-t border-white/[0.14] pt-3.5">
                {["Blue tick on profile, posts and chats", "Identity review by our team", offer.periodDays > 0 ? `Active for ${offer.periodDays} days from approval` : "Yours for good once approved"].map((t) => (
                  <li key={t} className="flex items-center gap-2.5 text-sm text-white/[0.92]"><Check className="shrink-0 text-[#93B4FF]" />{t}</li>
                ))}
              </ul>
            </div>
            <div className={cn("mt-3.5 rounded-[22px] p-4", OUT)}>
              <div className="flex justify-between gap-3 py-2 text-[15px]"><span className="text-frenz-muted">Frenz Verified{offer.periodDays > 0 ? ` · ${offer.periodDays} days` : ""}</span><span className="font-semibold tabular-nums">{money(offer.priceCents)}</span></div>
              <div className="flex justify-between gap-3 py-2 text-[15px]"><span className="text-frenz-muted">Taxes</span><span className="text-right font-semibold">Calculated at checkout</span></div>
              <div className="mt-1.5 flex justify-between gap-3 border-t border-frenz-line pt-3.5 text-[17px] font-extrabold"><span>Due today</span><span className="tabular-nums">{money(offer.priceCents)}</span></div>
            </div>
            <p className="mx-1 mt-3 text-[12.5px] leading-normal text-frenz-muted">The secure checkout shows the exact amount in the currency it charges. Your application goes to review once the payment is confirmed.</p>
          </section>
        ) : null}
      </div>
    </Frame>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: ReactNode; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-3.5">
      <label htmlFor={id} className="mx-1 mb-[7px] block text-[13.5px] font-semibold text-frenz-muted">{label}</label>
      {children}
      {hint ? <p className="mx-1 mt-1.5 text-[12.5px] text-frenz-muted">{hint}</p> : null}
      <Err show={!!error}>{error}</Err>
    </div>
  );
}

function Row({ k, v, onEdit, first }: { k: string; v: string; onEdit: () => void; first?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 py-[13px]", first ? "pt-0" : "border-t border-frenz-line")}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-frenz-muted">{k}</div>
        <div className="mt-0.5 break-words text-[15px] font-semibold">{v}</div>
      </div>
      <button type="button" onClick={onEdit} className={cn("px-1 py-2 text-sm font-semibold", ACCENT)}>Edit</button>
    </div>
  );
}

/* ───────────────────────────── after submitting ───────────────────────────── */

function Submitted({ submittedAt, paid, periodDays }: { submittedAt: string | null; paid: boolean; periodDays: number }) {
  const at = submittedAt ? new Date(submittedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Just now";
  const items: { title: string; sub: string; state: "done" | "now" | "" }[] = [
    { title: "Details submitted", sub: at, state: "done" },
    ...(paid ? [{ title: "Payment received", sub: "Receipt sent to your email", state: "done" as const }] : []),
    { title: "Identity review", sub: "We'll notify you as soon as there's a decision", state: "now" },
    { title: "Blue tick active", sub: periodDays > 0 && paid ? `For ${periodDays} days from approval` : "Shown across Frenz", state: "" },
  ];
  return (
    <Frame title="Verification" sub="Under review">
      <div className="pb-1 pt-2.5 text-center">
        <div className={cn("relative mx-auto mt-1.5 flex h-24 w-24 items-center justify-center rounded-[32px]", IN, ACCENT)}>
          <span aria-hidden className="absolute -inset-1.5 rounded-[38px] border-2 border-[#2F5BEA]/30 motion-safe:animate-[ping_2.2s_cubic-bezier(.2,.8,.2,1)_3]" />
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
        </div>
        <H2>You&apos;re in review</H2>
        <Lede>{paid ? "Payment received and your details are with our team." : "Your details are with our team."} We&apos;ll notify you as soon as there&apos;s a decision.</Lede>
      </div>
      <div className={cn("mt-5 rounded-3xl p-4", OUT)}>
        <ol>
          {items.map((it, i) => (
            <li key={it.title} className="relative flex gap-3.5 pb-5 last:pb-0">
              {i < items.length - 1 ? <span aria-hidden className="absolute bottom-0.5 left-[15px] top-8 w-0.5 bg-frenz-line" /> : null}
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", it.state === "done" ? "bg-emerald-600 text-white" : it.state === "now" ? cn(OUT_SM, "ring-2 ring-[#2F5BEA]", ACCENT) : cn(IN_SM, "text-frenz-muted"))}>
                {it.state === "done" ? <Check /> : it.state === "now" ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" /></svg> : <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden><path d={TICK_PATH} fill="currentColor" /></svg>}
              </span>
              <span><b className="mt-[5px] block text-[15px]">{it.title}</b><span className="mt-0.5 block text-[13px] text-frenz-muted">{it.sub}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </Frame>
  );
}

function Approved({ name, handle, avatarUrl, paidUntil }: { name: string; handle: string | null; avatarUrl: string | null; paidUntil: string | null }) {
  const [burst, setBurst] = useState<{ left: number; delay: number; color: string }[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#2F6BFF", "#7C3AED", "#22C55E", "#FBBF24", "#F472B6"];
    setBurst(Array.from({ length: 26 }, (_, i) => ({ left: Math.random() * 100, delay: Math.random() * 0.35, color: colors[i % colors.length]! })));
    navigator.vibrate?.([20, 60, 30]);
  }, []);
  return (
    <Frame title="Verification" sub="Verified">
      <style>{`@keyframes vfall{0%{opacity:1;transform:translateY(0) rotate(0)}100%{opacity:0;transform:translateY(240px) rotate(260deg)}}@keyframes vpop{from{transform:scale(0) rotate(-30deg)}to{transform:none}}`}</style>
      <div className="relative pb-1 pt-2.5 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {burst.map((p, i) => (
            <i key={i} className="absolute -top-2.5 h-3 w-[7px] rounded-sm opacity-0" style={{ left: `${p.left}%`, background: p.color, animation: `vfall 1.6s cubic-bezier(.2,.8,.2,1) ${p.delay}s forwards` }} />
          ))}
        </div>
        <div className={cn("relative mx-auto mt-1.5 flex h-[104px] w-[104px] items-center justify-center rounded-[34px]", IN)}>
          <Tick size={62} className="motion-safe:[animation:vpop_.7s_cubic-bezier(.34,1.56,.64,1)_.15s_both]" />
        </div>
        <H2>You&apos;re verified</H2>
        <Lede>Your blue tick is live on your profile, posts and chats.</Lede>
      </div>
      <div className={cn("mt-[18px] flex items-center gap-3.5 rounded-3xl p-4", OUT)}>
        <Avatar url={avatarUrl} size={56} />
        <div className="min-w-0">
          <b className="inline-flex items-center gap-1.5 text-lg tracking-[-0.2px]"><span className="truncate">{name}</span><Tick /></b>
          <span className="mt-0.5 block text-[13.5px] text-frenz-muted">
            {handle ? `@${handle}` : ""}
            {paidUntil ? ` · Active until ${new Date(paidUntil).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : ""}
          </span>
        </div>
      </div>
      <p className="mx-1 mt-3 text-[12.5px] leading-normal text-frenz-muted">If your name or the account&apos;s owner changes, tell <Link href="/support" className={cn("font-semibold", ACCENT)}>support</Link> so we can check it again.</p>
    </Frame>
  );
}
