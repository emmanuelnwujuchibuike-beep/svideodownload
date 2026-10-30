"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, Camera, EyeOff, Images, Loader2, Lock, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ROUNDED_CLIP } from "@/features/sub/blur-frame";
import { BlurLevelPicker, VisitorBlurPreview } from "@/features/sub/blur-level-picker";
import { exDanger, exField, exPrimary, exQuiet } from "@/features/sub/ui";
import { haptic } from "@/lib/motion/haptics";
import { beginCriticalActivity } from "@/lib/pwa/activity-lock";
import { makeBlurClip } from "@/lib/media/make-blur-clip";
import { makeThumb } from "@/lib/media/make-thumb";
import { presignUpload, uploadWithPlan } from "@/lib/storage/client-upload";
import { BLUR_CLIP_WIDTH_FOR, BLUR_FRAME_CLASS, DEFAULT_BLUR_LEVEL, type BlurLevel } from "@/lib/sub/blur-level";
import { cn } from "@/lib/utils";

/**
 * A new subscriber-only post (0227). The photos and videos go straight from the
 * device into the PRIVATE bucket through five-minute upload links. Visitors see the
 * post's OWN media blurred (0263/0305/0306) — there is no public cover any more
 * (owner, 2026-10-30: "why am I still seeing this old pattern of using cover picture
 * instead of the blur"); posts that already have one keep it, only as a last resort.
 */

type Picked = { file: File; kind: "image" | "video"; preview: string; width: number | null; height: number | null };

async function dims(file: File): Promise<{ width: number | null; height: number | null }> {
  if (!file.type.startsWith("image/")) return { width: null, height: null };
  try {
    const bmp = await createImageBitmap(file);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return { width: null, height: null };
  }
}

const extOf = (f: File) => (f.name.split(".").pop() || (f.type.split("/")[1] ?? "")).toLowerCase().slice(0, 8);

// 0261: the age check, loaded only when Mature is switched on
const AgeGateSheet = dynamic(() => import("@/features/age/age-gate-sheet").then((x) => x.AgeGateSheet), { ssr: false });

export function SubComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [items, setItems] = useState<Picked[]>([]);
  const [caption, setCaption] = useState("");
  // Part 3 (0248): locked = non-subscribers see a locked tile; hidden = they don't know it exists
  const [audience, setAudience] = useState<"locked" | "hidden">("locked");
  // 0261: Mature (18+) — opened only by subscribers who confirmed they're 18+. Never explicit.
  const [mature, setMature] = useState(false);
  // 0307: how blurry visitors see the locked post (owner, 2026-10-30) — chosen on the preview step, where it shows live
  const [blurLevel, setBlurLevel] = useState<BlurLevel>(DEFAULT_BLUR_LEVEL);
  // the creator's own age check: asked when Mature is switched on, never before (no fetch on open)
  const [ageGate, setAgeGate] = useState(false);
  const adultKnown = useRef(false);
  const toggleMature = () => {
    if (mature) return setMature(false);
    // the switch answers on the tap; the server's answer decides whether it stays on
    setMature(true);
    if (adultKnown.current) return;
    void fetch("/api/age", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ status?: string }>)
      .then((a) => {
        if (a.status === "adult") adultKnown.current = true;
        else setAgeGate(true);
      })
      .catch(() => setAgeGate(true));
  };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Part 4: compose → preview → publish. Nothing is uploaded or published before Publish.
  const [step, setStep] = useState<"compose" | "preview">("compose");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const dirty = items.length > 0 || caption.trim() !== "";
  const close = () => {
    if (busy) return;
    // an unpublished draft is never lost to a stray tap — and closing never publishes anything
    if (dirty && !confirmDiscard) return setConfirmDiscard(true);
    items.forEach((it) => URL.revokeObjectURL(it.preview));
    onClose();
  };
  const pick = useRef<HTMLInputElement>(null);
  // owner 2026-10-11: straight from the camera too, not only the gallery
  const shoot = useRef<HTMLInputElement>(null);

  const add = async (files: FileList | null) => {
    if (!files) return;
    const next: Picked[] = [];
    for (const f of Array.from(files).slice(0, 10 - items.length)) {
      const kind = f.type.startsWith("video/") ? "video" : f.type.startsWith("image/") ? "image" : null;
      if (!kind) continue;
      next.push({ file: f, kind, preview: URL.createObjectURL(f), ...(await dims(f)) });
    }
    setItems((x) => [...x, ...next]);
  };

  const post = async () => {
    if (!items.length) return setError("Add at least one photo or video.");
    haptic("selection");
    setError(null);
    const end = beginCriticalActivity();
    try {
      const media: { key: string; kind: "image" | "video"; width: number | null; height: number | null; thumbKey?: string; blurVideoUrl?: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        setBusy(`Uploading ${i + 1} of ${items.length}…`);
        setProgress(i / items.length);
        const plan = await fetch("/api/sub/posts/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: it.kind, ext: extOf(it.file) }) }).then((r) => r.json());
        if (!plan?.ok) throw new Error(plan?.error ?? "Couldn't upload.");
        const put = await fetch(plan.uploadUrl as string, { method: "PUT", body: it.file, headers: { "Content-Type": it.file.type || "application/octet-stream", "Cache-Control": "private, no-store" } });
        if (!put.ok) throw new Error("The upload didn't finish. Try again.");
        // a ~480 px preview beside it, so the gallery tile loads instantly (best-effort: never blocks the post)
        let thumbKey: string | undefined;
        const thumb = await makeThumb(it.file);
        if (thumb.blob) {
          const tp = await fetch("/api/sub/posts/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "image", ext: "jpg" }) }).then((r) => r.json()).catch(() => null);
          if (tp?.ok) {
            const tput = await fetch(tp.uploadUrl as string, { method: "PUT", body: thumb.blob, headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } }).catch(() => null);
            if (tput?.ok) thumbKey = tp.key as string;
          }
        }
        media.push({ key: plan.key as string, kind: it.kind, width: it.width ?? thumb.width, height: it.height ?? thumb.height, ...(thumbKey ? { thumbKey } : {}) });
      }
      setProgress(1);
      // a locked video plays BLURRED for non-subscribers (owner, 2026-10-28): a 24 px clip made here, the detail gone
      // before it leaves this device (lib/media/make-blur-clip.ts). EVERY video gets one (0306, owner 2026-10-29: an album
      // slides sideways, blurred, no cover needed). Best effort — without one, that slide shows its still preview.
      let blurVideoUrl: string | null = null;
      if (audience === "locked") {
        const videos = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === "video");
        for (const [n, { it, i }] of videos.entries()) {
          setBusy(videos.length > 1 ? `Making the blurred previews… ${n + 1} of ${videos.length}` : "Making the blurred preview…");
          // at the size the chosen blur level stores (lib/sub/blur-level.ts — 24 px unless Light)
          const clip = await makeBlurClip(it.file, BLUR_CLIP_WIDTH_FOR[blurLevel]).catch(() => null);
          const url = clip ? await uploadWithPlan(await presignUpload("video", clip.ext), clip.blob, clip.type).catch(() => null) : null;
          if (!url) continue;
          media[i]!.blurVideoUrl = url;
          // the post's own clip (0305) stays the first item's, as before
          if (i === 0) blurVideoUrl = url;
        }
      }
      setBusy("Publishing…");
      const res = await fetch("/api/sub/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption: caption.trim() || null, media, audience, mature, ...(blurVideoUrl ? { blurVideoUrl } : {}), ...(audience === "locked" ? { blurLevel } : {}) }) });
      const j = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      // the server checks the creator's age too: show the check rather than a dead end
      if (res.status === 403 && j?.code === "age_required") {
        adultKnown.current = false;
        setAgeGate(true);
      }
      if (!res.ok) throw new Error(j?.error ?? "Couldn't publish.");
      items.forEach((it) => URL.revokeObjectURL(it.preview));
      onPosted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      end();
      setBusy(null);
      setProgress(null);
    }
  };

  const first = items[0];
  const audiences = [
    { v: "locked" as const, title: "Locked preview", sub: "Visitors see your photos and videos blurred — videos play, blurred — and how many items. Never the caption or a clear picture." },
    { v: "hidden" as const, title: "Hidden", sub: "Visitors don't see it at all — no tile, no count. You and your subscribers still do." },
  ];

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="New exclusive post" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto ex-card ex-sheet p-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        <div className="mb-3 flex items-center justify-between gap-2">
          {step === "preview" ? (
            <button type="button" onClick={() => setStep("compose")} disabled={!!busy} className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 text-[14px] font-semibold transition active:bg-black/[0.06]">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Edit
            </button>
          ) : (
            <h2 className="inline-flex items-center gap-2 text-[17px] font-bold">
              <Lock className="h-4 w-4 text-primary" aria-hidden /> New exclusive post
            </h2>
          )}
          <span className="ml-auto text-[12px] font-medium text-muted-foreground">{step === "compose" ? "Step 1 of 2" : "Step 2 of 2 · Preview"}</span>
          <button type="button" aria-label="Close" onClick={close} disabled={!!busy} className="inline-flex h-10 w-10 items-center justify-center rounded-full transition active:bg-black/[0.06]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {confirmDiscard ? (
          <div role="alertdialog" aria-label="Discard this post?" className="mb-3 rounded-2xl bg-rose-500/[0.06] p-3 dark:bg-rose-500/10">
            <p className="text-[13.5px] font-semibold">Discard this post?</p>
            <p className="text-[12.5px] text-muted-foreground">Nothing has been published or uploaded.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => setConfirmDiscard(false)} className={exQuiet}>
                Keep editing
              </button>
              <button type="button" onClick={close} className={exDanger}>
                Discard
              </button>
            </div>
          </div>
        ) : null}

        <input ref={pick} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />
        <input ref={shoot} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />

        {step === "compose" ? (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {items.map((it, i) => (
                <div key={it.preview} className="relative aspect-square overflow-hidden rounded-xl bg-black/[0.05]">
                  {it.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local preview, never uploaded from here
                    <img src={it.preview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <video src={it.preview} muted className="h-full w-full object-cover" />
                  )}
                  <button type="button" aria-label="Remove" onClick={() => setItems((x) => x.filter((_, j) => j !== i))} className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
              {items.length < 10 ? (
                <>
                  <button type="button" onClick={() => pick.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] text-[11.5px] font-semibold text-muted-foreground transition active:scale-95">
                    <Images className="h-5 w-5" aria-hidden /> Gallery
                  </button>
                  <button type="button" onClick={() => shoot.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] text-[11.5px] font-semibold text-muted-foreground transition active:scale-95">
                    <Camera className="h-5 w-5" aria-hidden /> Camera
                  </button>
                </>
              ) : null}
            </div>
            <label htmlFor="sub-caption" className="sr-only">
              Caption
            </label>
            <textarea id="sub-caption" rows={3} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption for your subscribers" className={cn(exField, "mt-3 resize-none")} />
            <fieldset className="mt-3">
              <legend className="mb-1.5 text-[13px] font-semibold">Who can see that this post exists</legend>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" role="radiogroup">
                {audiences.map(({ v, title, sub }) => (
                  <button key={v} type="button" role="radio" aria-checked={audience === v} onClick={() => setAudience(v)} className={cn("flex items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition", audience === v ? "border-primary bg-primary/[0.07] ring-1 ring-primary/40" : "border-black/[0.08] dark:border-white/10")}>
                    {v === "locked" ? <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> : <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    <span>
                      <span className="block text-[13.5px] font-semibold">{title}</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">{sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            {/*
              0261 (owner 2026-10-18): Mature (18+). Suggestive, violent or strong-language posts only —
              sexually explicit content is not allowed at all (App Store / Play rules and the payment
              provider's terms). The server withholds a Mature post from anyone who hasn't confirmed 18+.
            */}
            <button
              type="button"
              role="switch"
              aria-checked={mature}
              onClick={toggleMature}
              className={cn("mt-3 flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition", mature ? "border-primary bg-primary/[0.07] ring-1 ring-primary/40" : "border-black/[0.08] dark:border-white/10")}
            >
              <span aria-hidden className="mt-0.5 flex h-6 min-w-[2.25rem] shrink-0 items-center justify-center rounded-md bg-black/[0.06] px-1 text-[11px] font-extrabold dark:bg-white/10">
                18+
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">Mature (18+)</span>
                <span className="block text-[11.5px] leading-snug text-muted-foreground">Only subscribers who confirm they&apos;re 18 or older can open it. Sexually explicit content isn&apos;t allowed.</span>
              </span>
              <span aria-hidden className={cn("mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors", mature ? "bg-primary" : "bg-black/15 dark:bg-white/20")}>
                <span className={cn("h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none", mature ? "translate-x-4" : "translate-x-0")} />
              </span>
            </button>
            <p className="mt-2 text-[12px] text-muted-foreground">Photos and videos stay private and can&apos;t be shared, linked or downloaded.</p>
            {error ? (
              <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            ) : null}
            <button type="button" onClick={() => (setError(null), setStep("preview"))} disabled={!items.length} className={cn(exPrimary, "mt-3 w-full justify-center")}>
              Preview
            </button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <figure>
                <figcaption className="mb-1.5 text-[12px] font-semibold text-muted-foreground">What subscribers see</figcaption>
                <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-black/[0.05] dark:bg-white/[0.07]">
                  {first?.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local preview
                    <img src={first.preview} alt="" className="h-full w-full object-cover" />
                  ) : first ? (
                    <video src={first.preview} muted className="h-full w-full object-cover" />
                  ) : null}
                  <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">
                    {items.length} {items.length === 1 ? "item" : "items"}
                  </span>
                  {mature ? <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-extrabold text-white">18+</span> : null}
                </div>
                {caption.trim() ? <p className="mt-1.5 line-clamp-3 text-[12.5px]">{caption.trim()}</p> : null}
              </figure>
              <figure>
                <figcaption className="mb-1.5 text-[12px] font-semibold text-muted-foreground">What visitors see</figcaption>
                {audience === "locked" ? (
                  <div className={cn("relative aspect-[4/5] rounded-2xl bg-[#1A1430]", ROUNDED_CLIP, BLUR_FRAME_CLASS)}>
                    {/* EXACTLY as visitors get it at the chosen level (owner, 2026-10-30) — the first item drawn at the size
                        the level stores and blurred the same way, a video still playing. Local only: nothing is uploaded. */}
                    {first ? <VisitorBlurPreview src={first.preview} kind={first.kind} level={blurLevel} /> : null}
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35 text-white">
                      <Lock className="h-5 w-5" aria-hidden />
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.08em]">Subscriber only</span>
                    </span>
                  </div>
                ) : (
                  <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-3 text-center">
                    <EyeOff className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <span className="text-[12px] leading-snug text-muted-foreground">Nothing. No tile, no count — visitors won&apos;t know it exists.</span>
                  </div>
                )}
              </figure>
            </div>
            {/* 0307: the creator sets how blurry visitors see it — the preview above follows the choice live */}
            {audience === "locked" ? <BlurLevelPicker value={blurLevel} onChange={setBlurLevel} disabled={!!busy} className="mt-3" /> : null}
            {progress !== null ? (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Upload progress">
                <div className="h-full w-full origin-left rounded-full bg-gradient-to-r from-primary to-accent transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${Math.max(0.06, progress)})` }} />
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            ) : null}
            <button type="button" onClick={() => void post()} disabled={!!busy || !items.length} className={cn(exPrimary, "mt-3 w-full")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy ?? (audience === "hidden" ? "Publish hidden post" : "Publish for subscribers")}
            </button>
          </>
        )}
      </div>
      {ageGate ? (
        <AgeGateSheet
          purpose="post"
          onClose={() => {
            setAgeGate(false);
            // closed without confirming 18+: the post can't be Mature
            if (!adultKnown.current) setMature(false);
          }}
          onVerified={() => {
            adultKnown.current = true;
            setAgeGate(false);
            setError(null);
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
