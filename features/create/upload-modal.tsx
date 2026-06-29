"use client";

import { CheckCircle2, Copy, ImagePlus, Loader2, Share2, Sparkles, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { closeUpload, useUploadOpen } from "@/features/create/upload-store";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const MAX_BYTES = 100 * 1024 * 1024;

export function UploadModal() {
  const open = useUploadOpen();
  if (!open) return null;
  return <ModalInner />;
}

function ModalInner() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState<"image" | "video">("image");
  const [caption, setCaption] = useState("");
  const [alsoReel, setAlsoReel] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

  const close = () => {
    if (preview) URL.revokeObjectURL(preview);
    closeUpload();
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const isVideo = f.type.startsWith("video/");
    const isImage = f.type.startsWith("image/");
    if (!isVideo && !isImage) return setErr("Please choose a photo or video.");
    if (f.size > MAX_BYTES) return setErr("File must be under 100 MB.");
    setErr(null);
    setFile(f);
    setKind(isVideo ? "video" : "image");
    setAlsoReel(isVideo);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  };

  const post = async () => {
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setErr("Please sign in.");
        return;
      }
      const ext = (file.name.split(".").pop() || (kind === "video" ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${user.id}/stories/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("post-media").upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });
      if (upErr) {
        setErr("Upload failed. Try a smaller file.");
        return;
      }
      const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
      const mediaUrl = pub.publicUrl;

      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl, mediaKind: kind, caption: caption.trim() || undefined, shareReel: alsoReel && kind === "video" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't post.");
        return;
      }
      const link = json.postId ? `${window.location.origin}/p/${json.postId}` : `${window.location.origin}/home`;
      setDoneUrl(link);
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!doneUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: "Check out my post on Frenz", url: doneUrl });
      else await navigator.clipboard.writeText(doneUrl);
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Create">
      <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-border bg-card text-foreground shadow-luxury sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Create</h3>
          <button type="button" onClick={close} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        {doneUrl ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <p className="mt-3 text-lg font-bold">Posted to your Story</p>
            <p className="mt-1 text-sm text-muted-foreground">{alsoReel && kind === "video" ? "Also shared as a Reel. " : ""}It disappears in 24 hours.</p>
            <div className="mt-5 flex justify-center gap-2">
              <button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white">
                <Share2 className="h-4 w-4" /> Share elsewhere
              </button>
              <button type="button" onClick={() => { navigator.clipboard?.writeText(doneUrl).catch(() => {}); }} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">
                <Copy className="h-4 w-4" /> Copy link
              </button>
            </div>
            <button type="button" onClick={close} className="mt-3 text-sm text-muted-foreground hover:text-foreground">Done</button>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <input ref={inputRef} type="file" accept="image/*,video/*" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />

            {preview ? (
              <div className="relative overflow-hidden rounded-2xl bg-neutral-950">
                {kind === "video" ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={preview} className="max-h-72 w-full object-contain" controls />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="max-h-72 w-full object-contain" />
                )}
                <button type="button" onClick={() => inputRef.current?.click()} className="absolute right-2 top-2 rounded-lg bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">Change</button>
              </div>
            ) : (
              <button type="button" onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-12 text-muted-foreground transition hover:border-primary/50 hover:text-foreground">
                <ImagePlus className="h-8 w-8" />
                <span className="text-sm font-semibold">Upload from gallery</span>
                <span className="text-xs">Photo or video · up to 100 MB</span>
              </button>
            )}

            {file ? (
              <>
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={300}
                  placeholder="Add a caption…"
                  className="h-11 w-full rounded-xl bg-background px-3.5 text-sm text-foreground outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                />
                {kind === "video" ? (
                  <button type="button" onClick={() => setAlsoReel((v) => !v)} aria-pressed={alsoReel} className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-secondary/30 p-3 text-left">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><Video className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">Also post as a Reel</span>
                      <span className="block text-xs text-muted-foreground">Share this video publicly on your profile</span>
                    </span>
                    <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", alsoReel ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border")}>
                      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", alsoReel ? "translate-x-5" : "translate-x-0.5")} />
                    </span>
                  </button>
                ) : null}
              </>
            ) : null}

            {err ? <p className="text-sm text-rose-400">{err}</p> : null}

            <button
              type="button"
              onClick={post}
              disabled={!file || busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Post to Story{alsoReel && kind === "video" ? " + Reel" : ""}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">Stories disappear after 24 hours.</p>
          </div>
        )}
      </div>
    </div>
  );
}
