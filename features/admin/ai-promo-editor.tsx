"use client";

import { Film, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { shrinkForUpload } from "@/features/admin/ai-showcase-editor";
import {
  DEFAULT_PROMO_TIMING,
  EMPTY_PROMO,
  PROMO_TIMING_LIMITS,
  PROMO_VIDEO,
  promoStages,
  type AiPromo,
  type AiPromoTiming,
} from "@/lib/ai/promo/config";
import { cn } from "@/lib/utils";

/**
 * Admin → Frenz AI → "Landing promotion" (Brief C §6–§7).
 *
 * Three blocks — the promotional video (+ its poster), the before/after
 * transformation pair, and the timing — and one Save. Every upload goes to the
 * shared `ai-showcase` bucket under `promo/`; nothing reaches the landing until
 * Save, which also refreshes the static landing page. Timing is clamped to
 * PROMO_TIMING_LIMITS so no value here can make the tile churn or stall.
 */
export function AiPromoEditor({ initial }: { initial: AiPromo | null }) {
  const [promo, setPromo] = useState<AiPromo>(initial ?? EMPTY_PROMO);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const update = (next: Partial<AiPromo>) => {
    setPromo((p) => ({ ...p, ...next }));
    setDirty(true);
  };

  const uploadImage = async (which: "before" | "after" | "poster", picked: File) => {
    setBusy(which);
    setMsg(null);
    try {
      // Vercel refuses bodies over 4.5 MB — shrink big photos here first.
      const file = picked.size > 4 * 1024 * 1024 ? await shrinkForUpload(picked) : picked;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/ai/promo", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; url?: string; bytes?: number };
      if (!res.ok || !json.ok || !json.url) {
        setMsg({ ok: false, text: json.error ?? "Upload failed." });
        return;
      }
      const url = json.url;
      if (which === "poster") {
        if (promo.video) update({ video: { ...promo.video, poster: url } });
      } else {
        const cur = promo.image ?? { before: "", after: "", enabled: true };
        update({ image: { ...cur, [which]: url } });
      }
      setMsg({ ok: true, text: `Image ready — ${Math.round((json.bytes ?? 0) / 1024)} kB. Press Save to publish.` });
    } finally {
      setBusy(null);
    }
  };

  // The clip goes straight to storage with a signed ticket — never through a Vercel function.
  const uploadVideo = async (file: File) => {
    setMsg(null);
    if (!(PROMO_VIDEO.mimeTypes as readonly string[]).includes(file.type)) {
      setMsg({ ok: false, text: "Use an MP4 or WebM video." });
      return;
    }
    if (file.size > PROMO_VIDEO.maxBytes) {
      setMsg({ ok: false, text: `That video is over ${Math.round(PROMO_VIDEO.maxBytes / (1024 * 1024))} MB — a promo clip is about 3 seconds.` });
      return;
    }
    setBusy("video");
    setPct(0);
    try {
      const res = await fetch("/api/admin/ai/promo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "video", contentType: file.type, size: file.size }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; uploadUrl?: string; url?: string };
      if (!res.ok || !json.ok || !json.uploadUrl || !json.url) {
        setMsg({ ok: false, text: json.error ?? "Could not start the upload." });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", json.uploadUrl!, true);
        xhr.setRequestHeader("content-type", file.type);
        xhr.setRequestHeader("cache-control", "max-age=31536000");
        xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage answered ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("The upload was interrupted."));
        xhr.send(file);
      });
      update({ video: { url: json.url, poster: promo.video?.poster ?? null, enabled: true } });
      setMsg({ ok: true, text: `Video ready — ${(file.size / (1024 * 1024)).toFixed(1)} MB. Add a poster, then press Save.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      // A half-filled pair cannot play — drop it rather than save something the tile will skip anyway.
      const body = { ...promo, image: promo.image && promo.image.before && promo.image.after ? promo.image : null };
      const res = await fetch("/api/admin/ai/promo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ promo: body }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; promo?: AiPromo };
      if (res.ok && json.ok && json.promo) {
        setPromo(json.promo);
        setDirty(false);
        setMsg({ ok: true, text: `Saved. The landing page plays: ${promoStages(json.promo).join(" → ")} → …` });
      } else {
        setMsg({ ok: false, text: json.error ?? "Failed to save." });
      }
    } finally {
      setBusy(null);
    }
  };

  const setTiming = (key: keyof AiPromoTiming, value: string) => update({ timing: { ...promo.timing, [key]: Number(value) } });

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Landing promotion</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        The Frenz AI tile on the landing page, in the slot Explore used to hold. It starts on your media the moment the page appears: your before/after pair → the Frenz AI intro → your video → again. A part with nothing uploaded, or switched off, is skipped; with nothing at all the tile shows the intro alone. Visitors never ask the server for this — it is built into the page when you save.
      </p>

      {/* ── Promotional video ── */}
      <div className="rounded-2xl border border-border/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Promotional video</p>
          {promo.video ? (
            <label className="ml-2 flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={promo.video.enabled} onChange={(e) => update({ video: { ...promo.video!, enabled: e.target.checked } })} className="h-4 w-4" />
              Shown
            </label>
          ) : null}
          {promo.video ? (
            <button type="button" onClick={() => update({ video: null })} className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">MP4 or WebM, about 3 seconds, up to {Math.round(PROMO_VIDEO.maxBytes / (1024 * 1024))} MB. Muted, no controls, plays only while the tile is on screen. Show a real Frenz AI result.</p>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          {promo.video ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={promo.video.url} poster={promo.video.poster ?? undefined} controls muted playsInline preload="none" className="h-40 w-[5.6rem] rounded-xl bg-black object-cover" />
          ) : null}
          <div className="flex flex-col gap-2">
            <FilePick label={promo.video ? "Replace video" : "Upload video"} accept="video/mp4,video/webm" icon={<Film className="h-4 w-4" />} busy={busy === "video"} onFile={(f) => void uploadVideo(f)} />
            {pct !== null ? <p className="text-xs tabular-nums text-muted-foreground">Uploading… {pct}%</p> : null}
            {promo.video ? (
              <>
                <FilePick label={promo.video.poster ? "Replace poster" : "Add poster image"} accept="image/jpeg,image/png,image/webp,image/avif" icon={<ImagePlus className="h-4 w-4" />} busy={busy === "poster"} onFile={(f) => void uploadImage("poster", f)} />
                <p className="max-w-xs text-xs text-muted-foreground">The poster shows until the clip can play, and instead of it on slow or data-saving connections.</p>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Transformation showcase ── */}
      <div className="mt-4 rounded-2xl border border-border/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Transformation showcase</p>
          {promo.image ? (
            <label className="ml-2 flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={promo.image.enabled} onChange={(e) => update({ image: { ...promo.image!, enabled: e.target.checked } })} className="h-4 w-4" />
              Shown
            </label>
          ) : null}
          {promo.image ? (
            <button type="button" onClick={() => update({ image: null })} className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Two pictures of the same subject: the original, and the Frenz AI result (a new background, a new style). They play side by side with a divider. Both are needed.</p>
        <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
          {(["before", "after"] as const).map((which) => (
            <div key={which} className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">{which === "before" ? "Original" : "Frenz AI result"}</p>
              <div className="aspect-[3/4] overflow-hidden rounded-xl bg-secondary">
                {promo.image?.[which] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={promo.image[which]} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <FilePick label={promo.image?.[which] ? "Replace" : "Upload"} accept="image/jpeg,image/png,image/webp,image/avif" icon={<ImagePlus className="h-4 w-4" />} busy={busy === which} onFile={(f) => void uploadImage(which, f)} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Timing ── */}
      <div className="mt-4 rounded-2xl border border-border/70 p-4">
        <p className="text-sm font-semibold">Timing (seconds)</p>
        <p className="mt-1 text-xs text-muted-foreground">The tile starts on your media as soon as the page appears, like the Wallpapers tile — picture first, then the intro, then video. Defaults: picture {DEFAULT_PROMO_TIMING.image} s, video {DEFAULT_PROMO_TIMING.video} s, intro {DEFAULT_PROMO_TIMING.intro} s. Each is kept within safe bounds.</p>
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(PROMO_TIMING_LIMITS) as (keyof AiPromoTiming)[]).filter((key) => key !== "delay").map((key) => (
            <label key={key} className="flex flex-col gap-1 text-xs font-medium capitalize">
              {key === "image" ? "Picture" : key}
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                min={PROMO_TIMING_LIMITS[key].min}
                max={PROMO_TIMING_LIMITS[key].max}
                value={promo.timing[key]}
                onChange={(e) => setTiming(key, e.target.value)}
                className="h-10 rounded-xl border border-border bg-background px-3 text-sm tabular-nums"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null || !dirty}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {msg ? <p role="status" className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
      </div>
    </section>
  );
}

function FilePick({ label, accept, icon, busy, onFile }: { label: string; accept: string; icon: React.ReactNode; busy: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-medium transition hover:bg-secondary disabled:opacity-50"
      >
        {icon}
        {busy ? "Uploading…" : label}
      </button>
    </>
  );
}
