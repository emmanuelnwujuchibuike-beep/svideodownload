"use client";

import { ArrowDown, ArrowUp, Film, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

import { SlideCard } from "@/features/ai/design/ai-showcase";
import {
  DEFAULT_SHOWCASE,
  SHOWCASE_LIMITS,
  SHOWCASE_TARGETS,
  SHOWCASE_VIDEO,
  isShowcaseTarget,
  type ShowcaseSlide,
} from "@/lib/ai/showcase/slides";
import { cn } from "@/lib/utils";

/**
 * Admin → Frenz AI → Welcome showcase.
 *
 * Owner, 2026-10-05: "The showcase card titles, description and images should
 * be able to be uploaded or change by the admin … must fit professional as it
 * is in the reference image with the font and everything."
 *
 * ── The preview IS the card ─────────────────────────────────────────────────
 * Each slide is previewed with `SlideCard` — the component the welcome page
 * renders — at 264 px, the card width on a 320 px phone, so what the admin sees is what ships,
 * font and crop included. Every field stops at the length the card was drawn
 * for (SHOWCASE_LIMITS); the server cuts to the same limits again.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * An image is resized on upload (two webp copies) and saved with the slide.
 * Save drops the cached welcome page for both doors; visitors never call
 * anything — the slides are in the HTML (lib/ai/showcase/server.ts).
 */

const input =
  "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function newId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function AiShowcaseEditor({ initial }: { initial: ShowcaseSlide[] | null }) {
  const [slides, setSlides] = useState<ShowcaseSlide[]>(initial ?? DEFAULT_SHOWCASE.map((s) => ({ ...s })));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const patch = (id: string, change: Partial<ShowcaseSlide>) => {
    setSlides((all) => all.map((s) => (s.id === id ? { ...s, ...change } : s)));
    setDirty(true);
  };
  const move = (i: number, delta: number) => {
    setSlides((all) => {
      const j = i + delta;
      if (j < 0 || j >= all.length) return all;
      const next = all.slice();
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    setDirty(true);
  };
  const remove = (id: string) => {
    setSlides((all) => all.filter((s) => s.id !== id));
    setDirty(true);
  };
  const add = () => {
    setSlides((all) =>
      all.length >= SHOWCASE_LIMITS.slides
        ? all
        : [...all, { id: newId(), enabled: true, chip: "", title: "New slide", highlight: "", description: "", target: "explore", image: null, video: null, alt: "" }],
    );
    setDirty(true);
  };

  const upload = async (id: string, picked: File) => {
    setUploading(id);
    setMsg(null);
    try {
      /*
        A Vercel function refuses a body over 4.5 MB, and a phone photo is often
        larger — shrink it here first (the server still makes the two final
        sizes). Smaller files go up untouched.
      */
      const file = picked.size > 4 * 1024 * 1024 ? await shrinkForUpload(picked) : picked;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/ai/showcase", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; image?: ShowcaseSlide["image"]; bytes?: { sm: number; lg: number } };
      if (!res.ok || !json.ok || !json.image) {
        setMsg({ ok: false, text: json.error ?? "Upload failed." });
        return;
      }
      patch(id, { image: json.image });
      if (json.bytes) {
        setMsg({ ok: true, text: `Image ready — ${Math.round(json.bytes.sm / 1024)} kB for phones, ${Math.round(json.bytes.lg / 1024)} kB for large screens. Press Save to publish.` });
      }
    } finally {
      setUploading(null);
    }
  };

  /*
    A clip goes STRAIGHT to storage (owner, 2026-10-06): the route signs a
    ticket for an admin, then the browser PUTs the file to the bucket — the
    bytes never pass through a Vercel function (4.5 MB body limit, and paid
    bandwidth). XHR rather than fetch for the progress figure.
  */
  const [videoProgress, setVideoProgress] = useState<{ id: string; pct: number } | null>(null);
  const uploadVideo = async (id: string, file: File) => {
    setMsg(null);
    if (!(SHOWCASE_VIDEO.mimeTypes as readonly string[]).includes(file.type)) {
      setMsg({ ok: false, text: "Use an MP4 or WebM video." });
      return;
    }
    if (file.size > SHOWCASE_VIDEO.maxBytes) {
      setMsg({ ok: false, text: `That video is over ${Math.round(SHOWCASE_VIDEO.maxBytes / (1024 * 1024))} MB — trim it to a few seconds.` });
      return;
    }
    setVideoProgress({ id, pct: 0 });
    try {
      const res = await fetch("/api/admin/ai/showcase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "video", contentType: file.type, size: file.size }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; uploadUrl?: string; video?: ShowcaseSlide["video"] };
      if (!res.ok || !json.ok || !json.uploadUrl || !json.video) {
        setMsg({ ok: false, text: json.error ?? "Could not start the upload." });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", json.uploadUrl!, true);
        xhr.setRequestHeader("content-type", file.type);
        xhr.setRequestHeader("cache-control", "max-age=31536000");
        xhr.upload.onprogress = (e) => e.lengthComputable && setVideoProgress({ id, pct: Math.round((e.loaded / e.total) * 100) });
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage answered ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("The upload was interrupted."));
        xhr.send(file);
      });
      patch(id, { video: json.video });
      setMsg({ ok: true, text: `Video ready — ${(file.size / (1024 * 1024)).toFixed(1)} MB. It plays muted while its slide is showing. Press Save to publish.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setVideoProgress(null);
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/ai/showcase", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slides }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; slides?: ShowcaseSlide[] };
      if (res.ok && json.ok && json.slides) {
        setSlides(json.slides);
        setDirty(false);
        setMsg({ ok: true, text: "Saved. The welcome page shows these slides now." });
      } else {
        setMsg({ ok: false, text: json.error ?? "Failed to save." });
      }
    } finally {
      setBusy(false);
    }
  };

  const enabledCount = slides.filter((s) => s.enabled).length;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Welcome showcase</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          The carousel on the Frenz AI welcome page (/ai and /studio/ai). It moves every 3 seconds. Each preview below is the real card at the width it has on the smallest phone, so if the words fit there they fit everywhere. Up to {SHOWCASE_LIMITS.slides} slides; switched-off slides are kept but not shown.
          {initial === null ? " Nothing has been saved yet, so visitors see the four starter slides below." : null}
        </p>

        <ol className="space-y-5">
          {slides.map((s, i) => (
            <li key={s.id} className={cn("rounded-2xl border border-border/70 p-4", !s.enabled && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">Slide {i + 1}</p>
                <label className="ml-2 flex items-center gap-2 text-xs font-medium">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => patch(s.id, { enabled: e.target.checked })} className="h-4 w-4" />
                  Shown
                </label>
                <div className="ml-auto flex items-center gap-1">
                  <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></IconButton>
                  <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === slides.length - 1}><ArrowDown className="h-4 w-4" /></IconButton>
                  <IconButton label="Delete slide" onClick={() => remove(s.id)}><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              </div>

              <div className="mt-3 grid gap-5 lg:grid-cols-[264px_1fr]">
                {/* the live preview — the shipped component, at the card width of the narrowest phone (320 px screen); if it fits here it fits everywhere */}
                <div className="w-full max-w-[264px]">
                  <SlideCard slide={s} index={i} count={slides.length} href="#" preview playing={!!s.video} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Chip" value={s.chip} max={SHOWCASE_LIMITS.chip} onChange={(v) => patch(s.id, { chip: v })} hint="Small label, top left" />
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Opens</span>
                    <select
                      value={s.target}
                      onChange={(e) => isShowcaseTarget(e.target.value) && patch(s.id, { target: e.target.value })}
                      className={input}
                    >
                      {Object.entries(SHOWCASE_TARGETS).map(([key, t]) => (
                        <option key={key} value={key}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                  <Field label="Title" value={s.title} max={SHOWCASE_LIMITS.title} onChange={(v) => patch(s.id, { title: v })} hint="First line, e.g. Turn Words" />
                  <Field label="Second line" value={s.highlight} max={SHOWCASE_LIMITS.highlight} onChange={(v) => patch(s.id, { highlight: v })} hint="e.g. Into Motion" />
                  <div className="sm:col-span-2">
                    <Field label="Description" value={s.description} max={SHOWCASE_LIMITS.description} onChange={(v) => patch(s.id, { description: v })} multiline />
                  </div>

                  <div className="sm:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">Image</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <ImageUploadButton busy={uploading === s.id} onFile={(f) => void upload(s.id, f)} hasImage={!!s.image} />
                      {s.image ? (
                        <button type="button" onClick={() => patch(s.id, { image: null, alt: "" })} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium">
                          <X className="h-3.5 w-3.5" aria-hidden /> Remove image
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">No image — the card draws the brand art. Landscape, 1600 px wide or more, looks best.</span>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-xs font-medium text-muted-foreground">Video (optional)</span>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <VideoUploadButton
                        busy={videoProgress?.id === s.id}
                        label={videoProgress?.id === s.id ? `Uploading ${videoProgress.pct}%` : s.video ? "Replace video" : "Upload video"}
                        onFile={(f) => void uploadVideo(s.id, f)}
                      />
                      {s.video ? (
                        <button type="button" onClick={() => patch(s.id, { video: null })} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium">
                          <X className="h-3.5 w-3.5" aria-hidden /> Remove video
                        </button>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {s.video
                          ? `${(s.video.bytes / (1024 * 1024)).toFixed(1)} MB · plays muted while this slide is showing`
                          : `MP4 or WebM, a few seconds, up to ${Math.round(SHOWCASE_VIDEO.maxBytes / (1024 * 1024))} MB. Add an image too — it is the poster everyone sees first.`}
                      </span>
                    </div>
                  </div>
                  {s.image ? (
                    <div className="sm:col-span-2">
                      <Field label="Image description (for screen readers)" value={s.alt} max={SHOWCASE_LIMITS.alt} onChange={(v) => patch(s.id, { alt: v })} hint="What the picture shows. Leave empty if it is decoration." />
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={add}
            disabled={slides.length >= SHOWCASE_LIMITS.slides}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border px-4 text-sm font-semibold disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add slide
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || uploading !== null}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save showcase"}
          </button>
          <span className="text-xs text-muted-foreground">
            {enabledCount === 0 ? "No slide is shown — the carousel will be hidden." : `${enabledCount} shown`}
            {dirty ? " · unsaved changes" : ""}
          </span>
        </div>
        {msg ? (
          <p role="status" className={cn("mt-3 text-sm", msg.ok ? "text-emerald-600" : "text-rose-500")}>
            {msg.text}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  max,
  onChange,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  hint?: string;
  multiline?: boolean;
}) {
  const left = max - value.length;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span className={cn("tabular-nums", left <= 3 && "text-amber-600")}>{value.length}/{max}</span>
      </span>
      {multiline ? (
        <textarea value={value} maxLength={max} rows={2} onChange={(e) => onChange(e.target.value)} className={input} />
      ) : (
        <input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} className={input} />
      )}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ImageUploadButton({ busy, hasImage, onFile }: { busy: boolean; hasImage: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
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
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold disabled:opacity-50"
      >
        <ImagePlus className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Resizing…" : hasImage ? "Replace image" : "Upload image"}
      </button>
    </>
  );
}

function VideoUploadButton({ busy, label, onFile }: { busy: boolean; label: string; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={SHOWCASE_VIDEO.mimeTypes.join(",")}
        className="sr-only"
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
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3 text-xs font-semibold disabled:opacity-50"
      >
        <Film className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
    </>
  );
}

/** Downscale a large photo in the browser so it fits under the 4.5 MB function body limit. */
export async function shrinkForUpload(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ? new File([blob], file.name.replace(/.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file; // the server will say if it is still too large
  }
}
