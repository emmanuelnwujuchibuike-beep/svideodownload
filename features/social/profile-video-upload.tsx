"use client";

import { Loader2, Video as VideoIcon } from "lucide-react";
import { useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Upload a short (≈3s) profile video to Supabase Storage. Uses the `post-media`
 * bucket (not `media`) because `media` only allows image MIME types + 5 MB —
 * `post-media` already permits video/mp4·webm·quicktime up to 100 MB with the
 * same user-scoped RLS (post-media/<uid>/…). Silent, loops. Returns the public
 * URL via onChange; onChange("") clears it.
 */
const VIDEO_BUCKET = "post-media";
export function ProfileVideoUpload({ value, onChange }: { value: string | null; onChange: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("video/")) return setErr("Please choose a video.");
    if (file.size > 20 * 1024 * 1024) return setErr("Video must be under 20 MB — a few seconds is enough.");

    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErr("Please sign in.");
        return;
      }
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const path = `${user.id}/profile-video-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(VIDEO_BUCKET).upload(path, file, {
        upsert: true,
        cacheControl: "3600",
        contentType: file.type,
      });
      if (error) {
        setErr(error.message || "Upload failed — try a shorter clip.");
        return;
      }
      const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      onChange(`${data.publicUrl}?v=${Date.now()}`);
    } catch {
      setErr("Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept="video/*" onChange={onFile} className="sr-only" aria-hidden tabIndex={-1} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Upload profile video"
          className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-secondary/40 text-muted-foreground"
        >
          {value ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={value} muted loop autoPlay playsInline className="h-full w-full object-cover" />
          ) : busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <VideoIcon className="h-6 w-6" />
          )}
        </button>
        <div className="min-w-0 text-sm">
          <p className="font-medium">Profile video <span className="font-normal text-muted-foreground/70">· optional</span></p>
          <p className="text-xs text-muted-foreground">A ~3-second clip. Silent, loops. Under 20 MB.</p>
          {value ? (
            <button type="button" onClick={() => onChange("")} className="mt-1 text-xs font-semibold text-red-500 hover:underline">
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {err ? <p className="mt-1.5 text-xs text-red-400">{err}</p> : null}
    </div>
  );
}
