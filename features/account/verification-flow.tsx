"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Camera,
  Check,
  ChevronRight,
  Clock,
  FileText,
  IdCard,
  Loader2,
  Lock,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { SETTINGS_TINTS, SettingsGroup } from "@/features/account/settings-ui";
import { createClient } from "@/lib/supabase/client";
import type {
  Eligibility,
  IdDocumentType,
  VerificationCategory,
  VerificationState,
} from "@/lib/social/verification";
import { ID_DOCUMENT_TYPES, VERIFICATION_CATEGORIES } from "@/lib/social/verification-shared";
import { cn } from "@/lib/utils";

/**
 * Verification — the member's side.
 *
 * Deliberately a GATED, staged flow rather than a form: the owner asked for it
 * to be "professional and gated with identity verification", with the applicant's
 * name matching their ID and a security selfie for confirmation.
 *
 *   1. Eligibility. The checklist is computed server-side from real account data
 *      and shown in full — including the rows they haven't cleared — so nobody is
 *      turned away by an invisible rule. "Continue" is inert until every row is met.
 *   2. Who you are. Category + the legal name EXACTLY as printed on the document,
 *      with an explicit confirmation that it matches; the name they are verified
 *      UNDER is their display name, shown here so a mismatch is obvious before
 *      a reviewer ever sees it.
 *   3. Document. Type, the last 4 characters only, and images of the ID.
 *   4. Security selfie. Captured live from the camera where one is available —
 *      a file picker alone would accept any photo of anyone.
 *   5. Review. Everything shown back before it is sent.
 *
 * Images go straight to the PRIVATE `verification-docs` bucket from the browser
 * (RLS confines each member to their own folder); only the storage PATHS are
 * submitted. Nothing here is ever publicly readable.
 */

const STEPS = ["Eligibility", "Identity", "Document", "Selfie", "Review"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

type Slot = "front" | "back" | "selfie";

interface Uploaded {
  path: string;
  preview: string;
}

export function VerificationFlow({
  state,
  eligibility,
  displayName,
}: {
  state: VerificationState;
  eligibility: Eligibility;
  displayName: string;
}) {
  // An approved or in-flight application has nothing to fill in — show its state.
  if (state.verified) return <VerifiedCard state={state} />;
  if (state.request && (state.request.status === "pending" || state.request.status === "in_review")) {
    return <PendingCard submittedAt={state.request.submittedAt} />;
  }
  return (
    <Application
      eligibility={eligibility}
      displayName={displayName}
      previousRejection={
        state.request?.status === "rejected"
          ? { code: state.request.rejectionCode, reason: state.request.decisionReason }
          : null
      }
    />
  );
}

/* ─────────────────────────────── States ───────────────────────────────── */

function VerifiedCard({ state }: { state: VerificationState }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-blue-500/25 bg-gradient-to-br from-blue-500/10 via-transparent to-violet-500/10 p-6 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/15">
        <BadgeCheck className="h-9 w-9 fill-blue-500 text-white" />
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-[-0.02em]">Your account is verified</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        The blue tick appears next to your name across Frenz. If your name or the account&apos;s owner changes, tell
        support so we can re-check it.
      </p>
      {state.request?.issuedDirectly ? (
        <p className="mt-3 text-xs text-muted-foreground">Issued directly by an administrator.</p>
      ) : null}
      <Link href="/support" className="btn-lux btn-lux-secondary mt-5 inline-flex">
        Contact support
      </Link>
    </div>
  );
}

function PendingCard({ submittedAt }: { submittedAt: string | null }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-border/70 bg-card p-6 text-center shadow-card">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
        <Clock className="h-8 w-8" />
      </span>
      <h2 className="mt-4 text-xl font-bold tracking-[-0.02em]">Under review</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        A reviewer is checking your documents. You&apos;ll be notified as soon as there&apos;s a decision — there&apos;s
        nothing else to do.
      </p>
      {submittedAt ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Submitted {new Date(submittedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
        </p>
      ) : null}
      <p className="mx-auto mt-4 max-w-sm text-xs text-muted-foreground">
        Your documents are stored privately and are only visible to the reviewer handling your application.
      </p>
    </div>
  );
}

/* ───────────────────────────── Application ────────────────────────────── */

function Application({
  eligibility,
  displayName,
  previousRejection,
}: {
  eligibility: Eligibility;
  displayName: string;
  previousRejection: { code: string | null; reason: string | null } | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);

  const [category, setCategory] = useState<VerificationCategory>("creator");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("");
  const [nameConfirmed, setNameConfirmed] = useState(false);
  const [docType, setDocType] = useState<IdDocumentType>("passport");
  const [last4, setLast4] = useState("");
  const [statement, setStatement] = useState("");
  const [files, setFiles] = useState<Partial<Record<Slot, Uploaded>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A passport is a single page; everything else has a reverse side.
  const needsBack = docType !== "passport";

  const canLeaveIdentity = legalName.trim().length >= 3 && country.trim().length >= 2 && nameConfirmed;
  const canLeaveDocument = !!files.front && (!needsBack || !!files.back) && last4.trim().length >= 3;
  const canLeaveSelfie = !!files.selfie;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          legalName: legalName.trim(),
          country: country.trim(),
          idDocumentType: docType,
          idNumberLast4: last4.trim().slice(-4),
          idFrontPath: files.front?.path,
          idBackPath: files.back?.path ?? null,
          selfiePath: files.selfie?.path,
          statement: statement.trim() || null,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Couldn't submit your application.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Your documents are still saved — try submitting again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {previousRejection ? (
        <div className="mb-5 flex gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-rose-500">Your last application was declined</p>
            <p className="mt-0.5 text-muted-foreground">
              {previousRejection.reason || "Please correct the issue below and apply again."}
            </p>
          </div>
        </div>
      ) : null}

      <StepRail step={step} />

      {step === 0 ? (
        <EligibilityStep eligibility={eligibility} onNext={() => setStep(1)} />
      ) : null}

      {step === 1 ? (
        <SettingsGroup label="WHO YOU ARE" description="This must match the government ID you're about to upload.">
          <Field icon={IdCard} tint="violet" title="Category" description="What kind of account is this?">
            <div className="grid gap-2 sm:grid-cols-2">
              {VERIFICATION_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  aria-pressed={category === c.value}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    category === c.value ? "border-primary bg-primary/5" : "border-border/70 hover:border-foreground/20",
                  )}
                >
                  <span className="block text-sm font-semibold">{c.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{c.blurb}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field icon={FileText} tint="amber" title="Full legal name" description="Exactly as printed on your ID or passport.">
            <input
              className={INPUT}
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="e.g. Ngor Paul Adeyemi"
              autoComplete="name"
            />
          </Field>

          <Field icon={ShieldCheck} tint="emerald" title="Country that issued it">
            <input className={INPUT} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Nigeria" autoComplete="country-name" />
          </Field>

          <div className="px-3.5 py-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={nameConfirmed}
                onChange={(e) => setNameConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded-md accent-[hsl(var(--brand-purple))]"
              />
              <span className="text-xs leading-relaxed text-muted-foreground">
                I confirm the name above matches my ID exactly, and that I am the person shown on it. You&apos;ll be
                verified under your display name, <span className="font-semibold text-foreground">{displayName}</span>.
                A name that doesn&apos;t match the document is the most common reason an application is declined.
              </span>
            </label>
          </div>
        </SettingsGroup>
      ) : null}

      {step === 2 ? (
        <SettingsGroup label="YOUR DOCUMENT" description="Photograph the whole document, flat, with nothing cropped off.">
          <Field icon={IdCard} tint="blue" title="Document type">
            <div className="grid grid-cols-2 gap-2">
              {ID_DOCUMENT_TYPES.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDocType(d.value)}
                  aria-pressed={docType === d.value}
                  className={cn(
                    "rounded-xl border py-2.5 text-sm font-semibold transition",
                    docType === d.value ? "border-primary bg-primary/5 text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </Field>

          <Field icon={Lock} tint="slate" title="Last 4 of the document number" description="We never store the full number.">
            <input
              className={cn(INPUT, "max-w-[10rem] tracking-[0.3em]")}
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\s/g, "").slice(-4).toUpperCase())}
              placeholder="••••"
              inputMode="text"
              maxLength={4}
            />
          </Field>

          <Field icon={Upload} tint="violet" title="Front of the document">
            <DocumentUpload slot="front" value={files.front} onChange={(u) => setFiles((f) => ({ ...f, front: u }))} />
          </Field>

          {needsBack ? (
            <Field icon={Upload} tint="purple" title="Back of the document">
              <DocumentUpload slot="back" value={files.back} onChange={(u) => setFiles((f) => ({ ...f, back: u }))} />
            </Field>
          ) : null}
        </SettingsGroup>
      ) : null}

      {step === 3 ? (
        <SettingsGroup label="SECURITY SELFIE" description="Confirms the person in the document is the person applying.">
          <Field icon={ScanFace} tint="rose" title="Take a live selfie" description="Face the camera in good light, no hat or sunglasses.">
            <SelfieCapture value={files.selfie} onChange={(u) => setFiles((f) => ({ ...f, selfie: u }))} />
          </Field>
          <div className="px-3.5 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your selfie and documents are stored privately, are never shown on your profile, and are only opened by
              the reviewer handling your application.
            </p>
          </div>
        </SettingsGroup>
      ) : null}

      {step === 4 ? (
        <SettingsGroup label="REVIEW AND SUBMIT">
          <Summary label="Category" value={VERIFICATION_CATEGORIES.find((c) => c.value === category)?.label ?? category} />
          <Summary label="Legal name" value={legalName} />
          <Summary label="Country" value={country} />
          <Summary label="Document" value={`${ID_DOCUMENT_TYPES.find((d) => d.value === docType)?.label} ···${last4}`} />
          <Summary label="Images" value={`${[files.front, files.back, files.selfie].filter(Boolean).length} attached`} />
          <Field icon={FileText} tint="cyan" title="Anything else?" description="Optional — links or context that help a reviewer.">
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              maxLength={600}
              placeholder="e.g. my work is published at …"
              className="min-h-[90px] w-full rounded-xl bg-background p-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
          </Field>
        </SettingsGroup>
      ) : null}

      {error ? <p className="mt-4 text-sm font-medium text-rose-500">{error}</p> : null}

      {step > 0 ? (
        <div className="mt-6 flex items-center gap-3">
          <button type="button" onClick={() => setStep((s) => (s - 1) as Step)} className="btn-lux btn-lux-secondary">
            Back
          </button>
          {step < 4 ? (
            <button
              type="button"
              disabled={(step === 1 && !canLeaveIdentity) || (step === 2 && !canLeaveDocument) || (step === 3 && !canLeaveSelfie)}
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="btn-lux btn-lux-primary"
            >
              Continue <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void submit()} className="btn-lux btn-lux-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Submit application
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

const INPUT =
  "h-11 w-full rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";

function StepRail({ step }: { step: Step }) {
  return (
    <ol className="mb-5 flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={cn("h-1 rounded-full transition", i <= step ? "bg-primary" : "bg-border")} />
          <span className={cn("truncate text-[10px] font-semibold uppercase tracking-wide", i === step ? "text-primary" : "text-muted-foreground/70")}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Field({
  icon: Icon,
  tint,
  title,
  description,
  children,
}: {
  icon: typeof IdCard;
  tint: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", SETTINGS_TINTS[tint] ?? SETTINGS_TINTS.slate)}>
          <Icon className="h-[19px] w-[19px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          {description ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children ? <div className="mt-2.5">{children}</div> : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-semibold">{value || "—"}</span>
    </div>
  );
}

function EligibilityStep({ eligibility, onNext }: { eligibility: Eligibility; onNext: () => void }) {
  return (
    <>
      <SettingsGroup
        label="ELIGIBILITY"
        description={`${eligibility.metCount} of ${eligibility.requiredCount} requirements met. Every rule is shown — there is nothing hidden behind the decision.`}
      >
        {eligibility.criteria.map((c) => (
          <div key={c.key} className="flex items-center gap-3 px-3.5 py-3">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                c.met ? "bg-emerald-500/15 text-emerald-500" : "bg-secondary text-muted-foreground",
              )}
            >
              {c.met ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sm font-semibold", !c.met && "text-muted-foreground")}>{c.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{c.detail}</span>
            </span>
          </div>
        ))}
      </SettingsGroup>

      <div className="mt-6">
        {eligibility.eligible ? (
          <button type="button" onClick={onNext} className="btn-lux btn-lux-primary">
            Start application <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <div className="rounded-2xl border border-border/70 bg-card p-4">
            <p className="text-sm font-semibold">Not yet eligible</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Clear the remaining rows above and this page will let you apply — no waiting list, no invitation. If you
              believe a rule is wrong for your account, contact support.
            </p>
            <Link href="/support" className="btn-lux btn-lux-secondary mt-3 inline-flex">
              Contact support
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

/* ───────────────────────────── Uploading ──────────────────────────────── */

/** Upload straight into the member's own folder in the private bucket. */
async function uploadPrivate(slot: Slot, file: Blob, ext: string): Promise<Uploaded> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  // `<uid>/...` is what the storage RLS policy keys on — a member can only ever
  // write inside their own folder.
  const path = `${user.id}/${slot}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("verification-docs").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return { path, preview: URL.createObjectURL(file) };
}

function DocumentUpload({ slot, value, onChange }: { slot: Slot; value?: Uploaded; onChange: (u: Uploaded | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      onChange(await uploadPrivate(slot, file, ext));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />
      {value ? (
        <div className="relative overflow-hidden rounded-2xl border border-border/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.preview} alt="" className="h-40 w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label="Remove"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md transition active:scale-90"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[11px] font-bold text-white">
            <Check className="h-3 w-3" /> Uploaded
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
          <span className="text-sm font-semibold">{busy ? "Uploading…" : "Take a photo or choose a file"}</span>
        </button>
      )}
      {err ? <p className="mt-2 text-xs font-medium text-rose-500">{err}</p> : null}
    </div>
  );
}

/**
 * Live selfie capture. A file picker would accept any saved image of anyone,
 * which defeats the point of the check, so this opens the camera and grabs a
 * frame. Where getUserMedia is unavailable or refused it falls back to the
 * device camera through a capture input rather than leaving the applicant stuck.
 */
function SelfieCapture({ value, onChange }: { value?: Uploaded; onChange: (u: Uploaded | undefined) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLive(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      setLive(true);
      // The <video> only exists once `live` is true, so attach on the next frame.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setErr("Camera unavailable. You can take a photo with your device camera instead.");
      fileInput.current?.click();
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 960;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      if (!blob) throw new Error("Couldn't capture the frame.");
      stop();
      onChange(await uploadPrivate("selfie", blob, "jpg"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Capture failed.");
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    return (
      <div className="relative mx-auto w-full max-w-[15rem] overflow-hidden rounded-2xl border border-border/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value.preview} alt="" className="aspect-[3/4] w-full object-cover" />
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="absolute inset-x-2 bottom-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-black/60 py-2 text-xs font-bold text-white backdrop-blur-md transition active:scale-95"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Retake
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          uploadPrivate("selfie", f, (f.name.split(".").pop() || "jpg").toLowerCase())
            .then(onChange)
            .catch((x: unknown) => setErr(x instanceof Error ? x.message : "Upload failed."))
            .finally(() => setBusy(false));
        }}
      />
      {live ? (
        <div className="mx-auto w-full max-w-[15rem]">
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-black">
            {/* `-scale-x-100` mirrors the preview so it behaves like a mirror. */}
            <video ref={videoRef} playsInline muted className="aspect-[3/4] w-full -scale-x-100 object-cover" />
          </div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={stop} className="btn-lux btn-lux-secondary flex-1 justify-center">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void capture()} className="btn-lux btn-lux-primary flex-1 justify-center">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Capture
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <ScanFace className="h-6 w-6" />}
          <span className="text-sm font-semibold">{busy ? "Uploading…" : "Open camera"}</span>
        </button>
      )}
      {err ? <p className="mt-2 text-xs font-medium text-amber-500">{err}</p> : null}
    </div>
  );
}
