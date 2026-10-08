"use client";

import { CircleAlert, CircleCheck, CloudUpload, ImageUp, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { AiButton } from "@/features/ai/design/ai-button";
import { IMAGE_MIME_TYPES, validateCreative, VIDEO_MIME_TYPES } from "@/lib/ads-platform/creative-validation";
import { adMessage } from "@/lib/ads-platform/messages";
import { formatBytes, type CatalogFormat } from "@/lib/ads-platform/offer";
import { cn } from "@/lib/utils";

import { Chip, Notice } from "./advertise-ui";
import { mediaTypeOf, posterFromVideo, putWithProgress, readLocalMedia } from "./upload-client";

/**
 * Step 4 — the upload, as simple as one tap.
 *
 *   pick → checked IN THE BROWSER against the admin's current limits (the same
 *   `validateCreative` the server runs), so a 21-second video or a 30 MB image
 *   is refused before a byte is sent → a signed PUT straight to Supabase with a
 *   progress bar → the server reads the real bytes and gives the verdict.
 *
 * The original file is shown from a local object URL — nothing is downloaded
 * to preview it.
 */

export interface UploadedCreative {
  id: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
}

type Phase = { kind: "idle" } | { kind: "checking" } | { kind: "uploading"; progress: number } | { kind: "verifying" } | { kind: "error"; messages: string[] };

async function post<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
    if (!res.ok || !json) return { ok: false, message: json?.message ?? adMessage("server") };
    return { ok: true, data: json };
  } catch {
    return { ok: false, message: "You appear to be offline. Please check your connection and try again." };
  }
}

export function CreativeStep({
  format,
  current,
  ensureDraft,
  onUploaded,
  recommended,
}: {
  format: CatalogFormat;
  current: UploadedCreative | null;
  ensureDraft: () => Promise<string | null>;
  onUploaded: (c: UploadedCreative, local: { src: string; mediaType: "image" | "video" } | null) => void;
  recommended: string | null;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const accept = [...(format.media_types.includes("image") ? IMAGE_MIME_TYPES : []), ...(format.media_types.includes("video") ? VIDEO_MIME_TYPES : [])].join(",");
  const limits = {
    code: format.code,
    mediaTypes: format.media_types,
    maxDurationSeconds: format.max_duration_seconds,
    maxFileBytes: format.max_file_bytes,
    maxWidth: format.max_width,
    maxHeight: format.max_height,
    minWidth: format.min_width,
    minHeight: format.min_height,
    aspectRatio: format.aspect_ratio,
    aspectTolerance: format.aspect_tolerance,
  };

  const choose = async (file: File) => {
    setFileName(file.name);
    setPhase({ kind: "checking" });
    const kind = mediaTypeOf(file);
    if (file.type === "video/quicktime") return setPhase({ kind: "error", messages: [adMessage("quicktime")] });
    if (!kind) return setPhase({ kind: "error", messages: [adMessage("not_recognised")] });
    // size first: never decode (or upload) something too large
    if (file.size > format.max_file_bytes) {
      return setPhase({ kind: "error", messages: [adMessage("file_too_large", { mediaType: kind, maxFileBytes: format.max_file_bytes })] });
    }
    const local = await readLocalMedia(file);
    if (!local) return setPhase({ kind: "error", messages: [adMessage("not_recognised")] });
    const verdict = validateCreative(
      { formatCode: format.code, mediaType: kind, mimeType: file.type, durationSeconds: local.durationSeconds, fileSizeBytes: file.size, width: local.width, height: local.height, destinationUrl: null },
      limits,
    );
    if (verdict.status === "invalid") {
      const facts = { ...local, mediaType: kind, fileSizeBytes: file.size, ...limits };
      return setPhase({ kind: "error", messages: verdict.errors.map((c) => adMessage(c, facts)) });
    }

    const campaignId = await ensureDraft();
    if (!campaignId) return setPhase({ kind: "idle" });
    const ticket = await post<{ creativeId: string; uploadUrl: string; posterUploadUrl: string | null }>("/api/ads/advertiser/upload", {
      campaignId,
      mediaType: kind,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!ticket.ok) return setPhase({ kind: "error", messages: [ticket.message] });

    abortRef.current = new AbortController();
    setPhase({ kind: "uploading", progress: 0 });
    if (kind === "video" && ticket.data.posterUploadUrl) {
      const poster = await posterFromVideo(file);
      if (poster) await putWithProgress({ url: ticket.data.posterUploadUrl, body: poster, contentType: poster.type || "image/webp", signal: abortRef.current.signal });
    }
    const ok = await putWithProgress({
      url: ticket.data.uploadUrl,
      body: file,
      contentType: file.type,
      signal: abortRef.current.signal,
      onProgress: (p) => setPhase({ kind: "uploading", progress: p }),
    });
    if (abortRef.current.signal.aborted) return setPhase({ kind: "idle" });
    if (!ok) return setPhase({ kind: "error", messages: [adMessage("upload_missing")] });

    setPhase({ kind: "verifying" });
    const fin = await post<{ ok: boolean; messages: string[]; mediaUrl: string | null; thumbnailUrl: string | null; facts: { width?: number; height?: number; durationSeconds?: number; fileSizeBytes?: number } }>(
      "/api/ads/advertiser/upload/finalize",
      { creativeId: ticket.data.creativeId },
    );
    if (!fin.ok) return setPhase({ kind: "error", messages: [fin.message] });
    if (!fin.data.ok || !fin.data.mediaUrl) return setPhase({ kind: "error", messages: fin.data.messages.length ? fin.data.messages : [adMessage("creative_not_valid")] });
    setPhase({ kind: "idle" });
    onUploaded(
      {
        id: ticket.data.creativeId,
        mediaType: kind,
        mediaUrl: fin.data.mediaUrl,
        thumbnailUrl: fin.data.thumbnailUrl,
        width: fin.data.facts.width ?? null,
        height: fin.data.facts.height ?? null,
        durationSeconds: fin.data.facts.durationSeconds ?? null,
        sizeBytes: fin.data.facts.fileSizeBytes ?? null,
      },
      { src: URL.createObjectURL(file), mediaType: kind },
    );
  };

  const working = phase.kind === "checking" || phase.kind === "uploading" || phase.kind === "verifying";
  const mediaWord = format.media_types.length === 2 ? "image or video" : format.media_types[0] === "video" ? "video" : "image";

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="indigo">{format.media_types.length === 2 ? "Image or video" : format.media_types[0] === "video" ? "Video only" : "Image only"}</Chip>
        {recommended ? <Chip>{recommended} px</Chip> : null}
        <Chip>Up to {formatBytes(format.max_file_bytes)}</Chip>
        {format.media_types.includes("video") && format.max_duration_seconds ? <Chip tone="amber">Video up to {format.max_duration_seconds} seconds</Chip> : null}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={working}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void choose(f);
        }}
      />

      {current && phase.kind === "idle" ? (
        <div className="mt-4 flex items-center gap-3 rounded-[1.4rem] bg-emerald-50/70 p-3.5 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-400/25">
          <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-card">
            {current.thumbnailUrl || current.mediaType === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- the validated public copy, small
              <img src={(current.thumbnailUrl ?? current.mediaUrl)!} alt="" className="h-full w-full object-cover" />
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-emerald-800">
              <CircleCheck className="h-4 w-4" aria-hidden /> Creative checked and ready
            </p>
            <p className="mt-0.5 text-[12.5px] text-emerald-900/70">
              {[current.width && current.height ? `${current.width} × ${current.height}` : null, current.durationSeconds ? `${Math.round(current.durationSeconds * 10) / 10} s` : null, current.sizeBytes ? formatBytes(current.sizeBytes) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <label htmlFor={inputId} className="inline-flex min-h-[2.75rem] cursor-pointer items-center gap-1 px-2 text-[13px] font-semibold text-indigo-700 dark:text-indigo-300">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Replace
          </label>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={cn(
            "mt-4 flex min-h-[11rem] cursor-pointer flex-col items-center justify-center rounded-[1.6rem] border-2 border-dashed p-6 text-center transition-colors",
            working ? "cursor-default border-indigo-200 bg-indigo-50/40 dark:border-indigo-400/30 dark:bg-indigo-500/10" : "border-indigo-200 bg-gradient-to-b from-white to-indigo-50/40 hover:border-indigo-400 dark:border-indigo-400/30 dark:from-white/[0.02] dark:to-indigo-500/10",
          )}
        >
          {phase.kind === "uploading" ? (
            <div className="w-full max-w-xs">
              <CloudUpload className="mx-auto h-7 w-7 text-indigo-600" aria-hidden />
              <p className="mt-2 text-[14px] font-semibold">Uploading… {Math.round(phase.progress * 100)}%</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-100" role="progressbar" aria-valuenow={Math.round(phase.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-[width] duration-200" style={{ width: `${Math.round(phase.progress * 100)}%` }} />
              </div>
              <p className="mt-2 truncate text-[12px] text-muted-foreground">{fileName}</p>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  abortRef.current?.abort();
                }}
                className="mt-2 inline-flex min-h-[2.75rem] items-center gap-1 text-[13px] font-semibold text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Cancel
              </button>
            </div>
          ) : working ? (
            <>
              <LoaderCircle className="h-7 w-7 animate-spin text-indigo-600" aria-hidden />
              <p className="mt-2 text-[14px] font-semibold">{phase.kind === "verifying" ? "Checking your file…" : "Reading your file…"}</p>
            </>
          ) : (
            <>
              <ImageUp className="h-7 w-7 text-indigo-600" aria-hidden />
              <p className="mt-2 text-[15px] font-semibold">Choose your {mediaWord}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">We check it before uploading, so you know right away if it fits.</p>
            </>
          )}
        </label>
      )}

      {phase.kind === "error" ? (
        <div className="mt-3 space-y-2">
          {phase.messages.map((m) => (
            <Notice key={m} icon={CircleAlert} tone="rose">
              {m}
            </Notice>
          ))}
          <AiButton variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            Choose another file
          </AiButton>
        </div>
      ) : null}
    </div>
  );
}
