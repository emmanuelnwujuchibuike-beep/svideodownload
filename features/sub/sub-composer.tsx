"use client";

import { Camera, ImagePlus, Images, Loader2, Lock, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { primaryPill, quietPill } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { beginCriticalActivity } from "@/lib/pwa/activity-lock";
import { makeThumb } from "@/lib/media/make-thumb";
import { presignUpload, uploadWithPlan } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";

/**
 * A new subscriber-only post (0227). The photos and videos go straight from the
 * device into the PRIVATE bucket through five-minute upload links; the optional
 * cover is an ordinary public image, because it is the teaser everyone sees.
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

export function SubComposer({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [items, setItems] = useState<Picked[]>([]);
  const [cover, setCover] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  // Part 3 (0248): locked = non-subscribers see a locked tile; hidden = they don't know it exists
  const [audience, setAudience] = useState<"locked" | "hidden">("locked");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  // owner 2026-10-11: straight from the camera too, not only the gallery
  const shoot = useRef<HTMLInputElement>(null);
  const pickCover = useRef<HTMLInputElement>(null);

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
      const media: { key: string; kind: "image" | "video"; width: number | null; height: number | null; thumbKey?: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        setBusy(`Uploading ${i + 1} of ${items.length}…`);
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
      let coverUrl: string | null = null;
      if (cover) {
        setBusy("Uploading the cover…");
        coverUrl = await uploadWithPlan(await presignUpload("image", extOf(cover)), cover, cover.type || "image/jpeg");
      }
      setBusy("Publishing…");
      const res = await fetch("/api/sub/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caption: caption.trim() || null, coverUrl, media, audience }) });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(j?.error ?? "Couldn't publish.");
      items.forEach((it) => URL.revokeObjectURL(it.preview));
      onPosted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      end();
      setBusy(null);
    }
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="New subscriber post" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] bg-background p-4 sm:rounded-[28px]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-[17px] font-bold">
            <Lock className="h-4 w-4 text-indigo-500" aria-hidden /> For subscribers
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={!!busy} className="inline-flex h-10 w-10 items-center justify-center rounded-full transition active:bg-black/[0.06]">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <input ref={pick} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />
        <input ref={shoot} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />
        <input ref={pickCover} type="file" accept="image/*" hidden onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
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
              <button type="button" onClick={() => pick.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-[11.5px] font-semibold text-muted-foreground transition active:scale-95">
                <Images className="h-5 w-5" aria-hidden /> Gallery
              </button>
              <button type="button" onClick={() => shoot.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-[11.5px] font-semibold text-muted-foreground transition active:scale-95">
                <Camera className="h-5 w-5" aria-hidden /> Camera
              </button>
            </>
          ) : null}
        </div>
        <label htmlFor="sub-caption" className="sr-only">
          Caption
        </label>
        <textarea id="sub-caption" rows={3} maxLength={2200} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write a caption for your subscribers" className="mt-3 w-full resize-none rounded-2xl border border-border bg-background px-3 py-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
        <button type="button" onClick={() => pickCover.current?.click()} className={cn(quietPill, "mt-2")}>
          <ImagePlus className="h-4 w-4" aria-hidden /> {cover ? `Cover: ${cover.name.slice(0, 24)}` : "Add a public cover (optional)"}
        </button>
        <fieldset className="mt-3">
          <legend className="mb-1.5 text-[12.5px] font-semibold">Who knows this post exists</legend>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
            {([
              ["locked", "Locked preview", "Everyone sees a locked tile"],
              ["hidden", "Hidden", "Only subscribers see it"],
            ] as const).map(([v, title, sub]) => (
              <button key={v} type="button" role="radio" aria-checked={audience === v} onClick={() => setAudience(v)} disabled={!!busy} className={cn("rounded-2xl border px-3 py-2.5 text-left transition", audience === v ? "border-primary bg-primary/[0.07] ring-1 ring-primary/40" : "border-border")}>
                <span className="block text-[13.5px] font-semibold">{title}</span>
                <span className="block text-[11.5px] text-muted-foreground">{sub}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <p className="mt-1.5 text-[12px] text-muted-foreground">The cover is the only thing non-subscribers see. Without one, they see a locked tile. Photos and videos stay private and can&apos;t be shared or linked.</p>
        {error ? <p className="mt-2 text-[13px] font-medium text-rose-600">{error}</p> : null}
        <button type="button" onClick={() => void post()} disabled={!!busy || !items.length} className={cn(primaryPill, "mt-3 w-full justify-center")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ?? "Post for subscribers"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
