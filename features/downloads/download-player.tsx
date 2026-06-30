"use client";

import { Download, Globe2, Loader2, Play, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getMedia, mediaKey } from "@/features/downloads/local-media";
import { startDownload } from "@/features/downloads/manager";
import { closePlayer, usePlayer } from "@/features/downloads/player-store";
import { toast } from "@/features/ui/toast";
import { saveBlob } from "@/lib/client-download";
import { createClient } from "@/lib/supabase/client";

export function DownloadPlayer() {
  const rec = usePlayer();
  if (!rec) return null;
  return <PlayerInner key={rec.id} />;
}

function PlayerInner() {
  const rec = usePlayer()!;
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notLocal, setNotLocal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [postId, setPostId] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    (async () => {
      const blob = await getMedia(mediaKey(rec.url, rec.formatId, rec.kind));
      if (!alive) return;
      if (blob) {
        blobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } else {
        setNotLocal(true);
      }
      setLoading(false);
    })();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePlayer();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [rec]);

  const reDownload = () => {
    startDownload({
      url: rec.url,
      formatId: rec.formatId,
      kind: rec.kind,
      title: rec.title,
      thumbnail: rec.thumbnail,
      platform: rec.platform,
      platformName: rec.platformName,
      qualityLabel: rec.qualityLabel,
    });
    closePlayer();
  };

  const publish = async () => {
    const blob = blobRef.current;
    if (!blob || publishing) return;
    setPublishing(true);
    const tid = toast("Publishing for everyone…", "loading");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast("Please sign in.", "error", { id: tid, duration: 3000 });
        return;
      }
      const ext = rec.kind === "audio" ? "mp3" : rec.kind === "image" ? "jpg" : "mp4";
      const path = `${user.id}/reels/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("post-media").upload(path, blob, { upsert: true, contentType: blob.type || undefined });
      if (upErr) {
        toast("Upload failed.", "error", { id: tid, duration: 3000 });
        return;
      }
      const { data: pub } = supabase.storage.from("post-media").getPublicUrl(path);
      const res = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: pub.publicUrl, mediaKind: rec.kind, title: rec.title, thumbnailUrl: rec.thumbnail, sourceUrl: rec.url }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't publish.", "error", { id: tid, duration: 3500 });
        return;
      }
      setPostId(json.postId as string);
      toast("Published! Everyone can watch it online.", "success", { id: tid, duration: 3500 });
    } catch {
      toast("Network error.", "error", { id: tid, duration: 3000 });
    } finally {
      setPublishing(false);
    }
  };

  const share = async () => {
    if (!postId) return;
    const link = `${window.location.origin}/p/${postId}`;
    try {
      if (navigator.share) await navigator.share({ title: rec.title, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast("Link copied.", "success", { duration: 2000 });
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-black/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={rec.title}>
      <button type="button" onClick={closePlayer} aria-label="Close" className="fixed right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
        ) : notLocal ? (
          <div className="max-w-sm text-center text-white">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10"><Play className="h-7 w-7" /></span>
            <p className="text-lg font-semibold">Not saved on this device</p>
            <p className="mt-1 text-sm text-white/70">Download it to watch in the app and publish it.</p>
            <button type="button" onClick={reDownload} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900">
              <Download className="h-4 w-4" /> Download to watch
            </button>
          </div>
        ) : url && rec.kind === "audio" ? (
          <div className="w-full max-w-md rounded-2xl bg-gradient-to-br from-blue-600 to-violet-700 p-8 text-white">
            {rec.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rec.thumbnail} alt="" className="mx-auto mb-5 h-40 w-40 rounded-2xl object-cover" />
            ) : null}
            <p className="mb-3 text-center font-semibold">{rec.title}</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio src={url} controls autoPlay className="w-full" />
          </div>
        ) : url && rec.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={rec.title} className="max-h-full max-w-full rounded-2xl object-contain" />
        ) : url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={url} controls autoPlay playsInline className="max-h-full w-full max-w-4xl rounded-2xl bg-black" />
        ) : null}
      </div>

      {/* Action bar */}
      {!notLocal && !loading ? (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-black/40 p-4">
          <p className="mr-auto hidden min-w-0 truncate pl-2 text-sm font-medium text-white sm:block">{rec.title}</p>
          {postId ? (
            <button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20">
              <Share2 className="h-4 w-4" /> Share
            </button>
          ) : (
            <button type="button" onClick={publish} disabled={publishing} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />} Publish to everyone
            </button>
          )}
          <button type="button" onClick={() => blobRef.current && saveBlob(blobRef.current, `${rec.title || "download"}`)} className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20">
            <Download className="h-4 w-4" /> Save to device
          </button>
        </div>
      ) : null}
    </div>
  );
}
