"use client";

import { AlertCircle, Download, ExternalLink, Globe2, Heart, Link2, Loader2, MoreVertical, Share2, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getMedia, mediaKey, saveMedia } from "@/features/downloads/local-media";
import { closePlayer, usePlayer } from "@/features/downloads/player-store";
import { removeDownload, toggleFavorite } from "@/features/history/store";
import { toast } from "@/features/ui/toast";
import { downloadUrl, saveBlob } from "@/lib/client-download";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function DownloadPlayer() {
  const rec = usePlayer();
  if (!rec) return null;
  return <PlayerInner key={rec.id} />;
}

function PlayerInner() {
  const rec = usePlayer()!;
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cachePct, setCachePct] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [postId, setPostId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [favorited, setFavorited] = useState(rec.favorite);
  const blobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    const controller = new AbortController();

    const play = (blob: Blob) => {
      blobRef.current = blob;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
      setLoading(false);
      setCachePct(null);
    };

    (async () => {
      const key = mediaKey(rec.url, rec.formatId, rec.kind);
      const cached = await getMedia(key);
      if (!alive) return;
      if (cached) return play(cached);

      // Not cached yet → stream it once for in-browser playback, then store it.
      setCachePct(0);
      try {
        const res = await fetch(downloadUrl({ url: rec.url, formatId: rec.formatId, kind: rec.kind, title: rec.title }), { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error();
        const total = Number(res.headers.get("content-length")) || 0;
        const ct = res.headers.get("content-type") || "video/mp4";
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.length;
            if (total && alive) setCachePct(Math.min(99, Math.round((received / total) * 100)));
          }
        }
        if (!alive) return;
        const blob = new Blob(chunks as BlobPart[], { type: ct });
        void saveMedia(key, blob);
        play(blob);
      } catch {
        if (alive && !controller.signal.aborted) {
          setError(true);
          setLoading(false);
          setCachePct(null);
        }
      }
    })();

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePlayer();
    window.addEventListener("keydown", onKey);
    // overflowY only — the `overflow` shorthand also resets overflow-x, undoing
    // the `overflow-x: clip` on <body> that keeps the app sidebar sticky.
    document.body.style.overflowY = "hidden";
    return () => {
      alive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = "";
    };
  }, [rec]);

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
      let publicUrl: string;
      try {
        // Main media → Cloudflare R2 when configured, else Supabase.
        publicUrl = await uploadPostMedia({
          data: blob,
          kind: rec.kind,
          ext,
          contentType: blob.type || (rec.kind === "audio" ? "audio/mpeg" : rec.kind === "image" ? "image/jpeg" : "video/mp4"),
        });
      } catch {
        toast("Upload failed.", "error", { id: tid, duration: 3000 });
        return;
      }
      const res = await fetch("/api/reels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: publicUrl, mediaKind: rec.kind, title: rec.title, thumbnailUrl: rec.thumbnail, sourceUrl: rec.url }),
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

  // ── Overflow (•••) actions ────────────────────────────────────────────────
  const copyLink = async () => {
    setMoreOpen(false);
    try {
      await navigator.clipboard.writeText(rec.url);
      toast("Source link copied.", "success", { duration: 2000 });
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };
  const openOriginal = () => {
    setMoreOpen(false);
    window.open(rec.url, "_blank", "noopener");
  };
  // Re-opens the downloader on this same source with the full quality picker,
  // so a video that won't play at this quality can be re-downloaded at another.
  const chooseAnotherQuality = () => {
    setMoreOpen(false);
    closePlayer();
    router.push(`/downloads?u=${encodeURIComponent(rec.url)}`);
  };
  const toggleFav = () => {
    setMoreOpen(false);
    const next = !favorited;
    setFavorited(next);
    toggleFavorite(rec.id);
  };
  const removeFromHistory = () => {
    setMoreOpen(false);
    removeDownload(rec.id);
    closePlayer();
    toast("Removed from downloads.", "info", { duration: 2000 });
  };

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-black/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={rec.title}>
      {/* Close top-left / options top-right — same convention every other
          full-screen media viewer in the app uses (reels, image viewer). */}
      <button type="button" onClick={closePlayer} aria-label="Close" className="fixed left-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20">
        <X className="h-5 w-5" />
      </button>
      <button type="button" onClick={() => setMoreOpen(true)} aria-label="More options" className="fixed right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20">
        <MoreVertical className="h-5 w-5" />
      </button>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        {error ? (
          <div className="max-w-sm text-center text-white">
            <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10"><AlertCircle className="h-7 w-7" /></span>
            <p className="text-lg font-semibold">Couldn&apos;t load this video</p>
            <p className="mt-1 text-sm text-white/70">The source may be unavailable. Try again later.</p>
          </div>
        ) : cachePct !== null && !url ? (
          <div className="w-full max-w-xs text-center text-white">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/70" />
            <p className="mt-3 text-sm font-medium">Loading video… {cachePct}%</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${cachePct}%` }} /></div>
          </div>
        ) : loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-white/70" />
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
      {url ? (
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

      {/* Options (•••) menu — secondary actions that don't need a permanent
          button in the action bar above. */}
      <AnimatePresence>
        {moreOpen ? (
          <div className="fixed inset-0 z-[95] flex items-end justify-center">
            <motion.button
              type="button"
              aria-label="Close"
              onClick={() => setMoreOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div
              role="menu"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
              className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
            >
              <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-border" />
              <div className="p-1.5">
                <div className="mb-1.5 overflow-hidden rounded-2xl bg-secondary/30">
                  <MoreItem icon={Heart} label={favorited ? "Unfavorite" : "Favorite"} active={favorited} onClick={toggleFav} />
                  {rec.kind === "video" ? (
                    <MoreItem icon={Download} label="Choose a different quality" onClick={chooseAnotherQuality} />
                  ) : null}
                  <MoreItem icon={Link2} label="Copy source link" onClick={copyLink} />
                  <MoreItem icon={ExternalLink} label="Open original post" onClick={openOriginal} />
                </div>
                <div className="overflow-hidden rounded-2xl bg-secondary/30">
                  <MoreItem icon={Trash2} label="Remove from downloads" onClick={removeFromHistory} danger />
                </div>
              </div>
              <div className="p-1.5 pt-0">
                <button type="button" onClick={() => setMoreOpen(false)} className="w-full rounded-2xl bg-secondary/70 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary active:scale-[0.99]">
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MoreItem({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: typeof Heart;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-3.5 px-4 py-3 text-left text-[15px] font-medium transition first:rounded-t-2xl last:rounded-b-2xl active:scale-[0.99]",
        danger ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-secondary/70",
      )}
    >
      <Icon className={cn("h-5 w-5 shrink-0 opacity-90", active && "fill-rose-500 text-rose-500")} strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
