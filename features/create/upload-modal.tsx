"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Copy,
  Images,
  Layers,
  Loader2,
  Plus,
  Share2,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { NEUTRAL_EDIT, PhotoEditor, type PhotoEdit } from "@/features/create/photo-editor";
import { openStudio } from "@/features/create/studio/studio-store";
import { closeUpload, useUploadIntent, useUploadOpen } from "@/features/create/upload-store";
import { captureVideoPoster } from "@/lib/media/video-poster";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_ITEMS = 20;

type Destination = "post" | "reel" | "story" | "both";

/** One item of the (possibly multi-media) post. Edits are non-destructive:
 * the original file + parameter object are kept; `file`/`display` hold the
 * baked result after Apply. */
interface AlbumItem {
  id: string;
  file: File;
  original: File;
  kind: "image" | "video";
  /** Object URL of the ORIGINAL (the editor always derives from this). */
  preview: string;
  /** Object URL currently shown (edited output, or the original). */
  display: string;
  edit: PhotoEdit;
}

export function UploadModal() {
  const open = useUploadOpen();
  if (!open) return null;
  return <ModalInner />;
}

function ModalInner() {
  const router = useRouter();
  const intent = useUploadIntent();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<AlbumItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [caption, setCaption] = useState("");
  const [destination, setDestination] = useState<Destination>(intent === "story" ? "story" : "post");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const active = items[Math.min(activeIdx, Math.max(0, items.length - 1))];
  const isAlbum = items.length > 1;
  const hasVideo = items.some((i) => i.kind === "video");
  const hasImage = items.some((i) => i.kind === "image");
  const mixed = hasVideo && hasImage;

  const revoke = (it: AlbumItem) => {
    URL.revokeObjectURL(it.preview);
    if (it.display !== it.preview) URL.revokeObjectURL(it.display);
  };

  const close = () => {
    items.forEach(revoke);
    closeUpload();
  };

  /** Pick a destination that's valid for the current selection. Rules:
   * photos → feed; single video → Reels (or story); multi-video/multi-upload
   * albums → Feed ONLY (Reels never carries more than one video — owner
   * rule); MIXED albums → feed ONLY. Stories are single-media. */
  const fixDestination = (next: AlbumItem[], current: Destination): Destination => {
    const video = next.some((i) => i.kind === "video");
    const album = next.length > 1;
    if (album) return "post"; // any album (video, photo, or mixed) → Feed only
    if (video) return current === "story" ? "story" : "reel";
    return current === "reel" ? "post" : current;
  };

  const accept = (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const fresh: AlbumItem[] = [];
    for (const f of list) {
      const isVideo = f.type.startsWith("video/");
      const isImage = f.type.startsWith("image/");
      if (!isVideo && !isImage) {
        setErr("Please choose photos or videos.");
        continue;
      }
      if (f.size > MAX_BYTES) {
        setErr(`"${f.name}" is over 100 MB — skipped.`);
        continue;
      }
      if (items.length + fresh.length >= MAX_ITEMS) {
        setErr(`Up to ${MAX_ITEMS} items per post.`);
        break;
      }
      const url = URL.createObjectURL(f);
      fresh.push({
        id: crypto.randomUUID(),
        file: f,
        original: f,
        kind: isVideo ? "video" : "image",
        preview: url,
        display: url,
        edit: NEUTRAL_EDIT,
      });
    }
    if (fresh.length === 0) return;
    setErr(null);
    setEditing(false);
    setItems((prev) => {
      const next = [...prev, ...fresh];
      setDestination((d) => fixDestination(next, d));
      setActiveIdx(prev.length); // jump to the first newly added item
      return next;
    });
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    accept(files);
    e.target.value = "";
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;
      revoke(prev[idx]!);
      const next = prev.filter((i) => i.id !== id);
      setActiveIdx((a) => Math.max(0, Math.min(a > idx ? a - 1 : a, next.length - 1)));
      setDestination((d) => fixDestination(next, d));
      return next;
    });
  };

  /** Reorder the active item one step (item 0 is the cover). */
  const moveActive = (dir: -1 | 1) => {
    setItems((prev) => {
      const from = activeIdx;
      const to = from + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it!);
      setActiveIdx(to);
      return next;
    });
  };

  const publish = async () => {
    if (items.length === 0 || busy) return;
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

      // Upload every item (cover first) with progress. Video items also get a
      // first-frame poster so the feed/reels always have a cover.
      const uploaded: { url: string; kind: "image" | "video"; thumbnailUrl: string | null }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        setBusyText(items.length > 1 ? `Uploading ${i + 1} of ${items.length}…` : "Uploading…");
        const ext = (it.file.name.split(".").pop() || (it.kind === "video" ? "mp4" : "jpg"))
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        let posterBlob: Blob | null = null;
        if (it.kind === "video") posterBlob = await captureVideoPoster(it.file).catch(() => null);

        let mediaUrl: string;
        try {
          mediaUrl = await uploadPostMedia({
            data: it.file,
            kind: it.kind,
            ext,
            contentType: it.file.type || (it.kind === "video" ? "video/mp4" : "image/jpeg"),
          });
        } catch (e) {
          setErr(e instanceof Error ? e.message : `Upload failed on item ${i + 1}. Try a smaller file.`);
          return;
        }

        let thumbnailUrl: string | null = null;
        if (posterBlob) {
          thumbnailUrl = await uploadPostMedia({ data: posterBlob, kind: "image", ext: "jpg", contentType: "image/jpeg" }).catch(
            () => null,
          );
        }
        uploaded.push({ url: mediaUrl, kind: it.kind, thumbnailUrl });
      }

      setBusyText("Publishing…");
      const cover = uploaded[0]!;
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: cover.url,
          mediaKind: cover.kind,
          caption: caption.trim() || undefined,
          thumbnailUrl: cover.kind === "image" ? cover.url : (cover.thumbnailUrl ?? undefined),
          destination,
          ...(uploaded.length > 1 ? { media: uploaded.map((u) => ({ url: u.url, kind: u.kind, thumbnailUrl: u.thumbnailUrl })) } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't publish.");
        return;
      }
      const link = json.postId ? `${window.location.origin}/p/${json.postId}` : `${window.location.origin}/home`;
      setDoneUrl(link);
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
      setBusyText(null);
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

  // Destination options adapt to the selection (Feed and Reels are separate
  // products; stories are single-media; every kind of album — mixed, photo,
  // OR multi-video — is Feed-only: Reels never carries more than one video).
  const DEST: { id: Destination; label: string; icon: typeof Clock; hint: string }[] = mixed
    ? [{ id: "post", label: "Feed", icon: Sparkles, hint: "Mixed albums post to the feed" }]
    : isAlbum && hasVideo
      ? [{ id: "post", label: "Feed", icon: Sparkles, hint: "Swipeable video album in the feed" }]
      : isAlbum
        ? [{ id: "post", label: "Feed", icon: Sparkles, hint: "Swipeable photo album" }]
        : hasVideo
          ? [
              { id: "reel", label: "Reel", icon: Clapperboard, hint: "Full-screen Reels" },
              { id: "story", label: "Story", icon: Clock, hint: "Disappears in 24h" },
            ]
          : [
              { id: "post", label: "Post", icon: Sparkles, hint: "On your profile & feed" },
              { id: "story", label: "Story", icon: Clock, hint: "Disappears in 24h" },
              { id: "both", label: "Both", icon: Layers, hint: "Post + story" },
            ];

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Create">
      <motion.div
        initial={{ y: 80, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-card/95 text-foreground shadow-luxury backdrop-blur-2xl sm:rounded-3xl"
      >
        {/* Ambient gradient wash — electric blue → royal purple */}
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 h-52 w-52 rounded-full bg-primary/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-16 top-10 h-52 w-52 rounded-full bg-accent/25 blur-3xl" />

        {/* Grab handle — bottom-sheet affordance on mobile */}
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden" />

        <div className="relative flex items-center justify-between px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Wand2 className="h-4 w-4 text-foreground" />
            <span className="text-gradient">{isAlbum ? `New Post · ${items.length} items` : "Create"}</span>
          </h3>
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <input ref={galleryRef} type="file" accept="image/*,video/*" multiple onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />
        <input ref={cameraRef} type="file" accept="video/*,image/*" capture="user" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />

        <div className="relative flex-1 overflow-y-auto px-5 pb-6">
          <AnimatePresence mode="wait">
            {doneUrl ? (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-10 text-center">
                <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
                  <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
                </motion.div>
                <p className="mt-3 text-lg font-bold">
                  {destination === "story" ? "Shared to your Story" : destination === "both" ? "Posted & shared to Story" : destination === "reel" ? "Your Reel is live" : isAlbum ? "Your album is live" : "Posted"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {destination === "post"
                    ? isAlbum
                      ? "Swipe through it on your profile and the feed."
                      : "It's live on your profile and the feed."
                    : destination === "reel"
                      ? "It's live in Reels and on your profile."
                      : destination === "both"
                        ? "Live on your profile; story vanishes in 24h."
                        : "Your story disappears in 24 hours."}
                </p>
                <div className="mt-5 flex justify-center gap-2">
                  <button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white">
                    <Share2 className="h-4 w-4" /> Share
                  </button>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(doneUrl).catch(() => {})} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold">
                    <Copy className="h-4 w-4" /> Copy link
                  </button>
                </div>
                <button type="button" onClick={close} className="mt-3 text-sm text-muted-foreground hover:text-foreground">Done</button>
              </motion.div>
            ) : items.length === 0 ? (
              /* ── Capture stage ─────────────────────────────────────────── */
              <motion.div
                key="stage"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  accept(e.dataTransfer.files);
                }}
              >
                <div
                  className={cn(
                    "relative flex h-72 flex-col items-center justify-center overflow-hidden rounded-3xl border bg-gradient-to-br from-blue-600/15 via-violet-600/10 to-fuchsia-600/15 transition",
                    dragging ? "border-violet-400 ring-2 ring-violet-500/40" : "border-white/10",
                  )}
                >
                  {/* Floating orbs */}
                  {[
                    { c: "from-blue-500 to-cyan-400", s: 90, x: "12%", y: "18%", d: 0 },
                    { c: "from-violet-500 to-fuchsia-500", s: 70, x: "72%", y: "30%", d: 0.6 },
                    { c: "from-emerald-400 to-teal-400", s: 56, x: "60%", y: "70%", d: 1.1 },
                  ].map((o, i) => (
                    <motion.span
                      key={i}
                      aria-hidden
                      className={cn("absolute rounded-full bg-gradient-to-br opacity-30 blur-xl", o.c)}
                      style={{ height: o.s, width: o.s, left: o.x, top: o.y }}
                      animate={{ y: [0, -14, 0], x: [0, 8, 0] }}
                      transition={{ duration: 5 + i, repeat: Infinity, ease: "easeInOut", delay: o.d }}
                    />
                  ))}

                  {/* Shutter */}
                  <motion.button
                    type="button"
                    onClick={() => galleryRef.current?.click()}
                    whileTap={{ scale: 0.92 }}
                    className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-luxury"
                  >
                    <span className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 blur-md opacity-60" />
                    <Sparkles className="relative h-8 w-8" />
                  </motion.button>
                  <p className="relative z-10 mt-4 text-sm font-semibold">Start creating</p>
                  <p className="relative z-10 mt-0.5 text-xs text-muted-foreground">Drop files, record, or pick several from your gallery</p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => cameraRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 py-3.5 text-sm font-semibold transition hover:bg-secondary">
                    <Camera className="h-5 w-5 text-foreground" /> Record
                  </button>
                  <button type="button" onClick={() => galleryRef.current?.click()} className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 py-3.5 text-sm font-semibold transition hover:bg-secondary">
                    <Images className="h-5 w-5 text-foreground" /> Gallery
                  </button>
                </div>
                {/* Rich, block-based composer */}
                <button
                  type="button"
                  onClick={() => {
                    closeUpload();
                    openStudio();
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card/60 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <Wand2 className="h-4 w-4" /> Write a story — blocks, text &amp; media
                </button>

                {err ? <p className="mt-3 text-center text-sm text-rose-400">{err}</p> : null}
                <p className="mt-3 text-center text-[11px] text-muted-foreground">Photos & videos · up to 100 MB · up to {MAX_ITEMS} per post</p>
              </motion.div>
            ) : editing && active && active.kind === "image" ? (
              /* ── Studio photo editor (non-destructive, per item) ───────── */
              <PhotoEditor
                src={active.preview}
                original={active.original}
                initial={active.edit}
                onCancel={() => setEditing(false)}
                onApply={({ blob, edit: nextEdit }) => {
                  setItems((prev) =>
                    prev.map((it) => {
                      if (it.id !== active.id) return it;
                      if (it.display !== it.preview) URL.revokeObjectURL(it.display);
                      const edited = new File([blob], it.original.name.replace(/\.\w+$/, "") + "-edited.jpg", { type: "image/jpeg" });
                      return { ...it, file: edited, display: URL.createObjectURL(edited), edit: nextEdit };
                    }),
                  );
                  setEditing(false);
                }}
              />
            ) : (
              /* ── Compose ───────────────────────────────────────────────── */
              <motion.div key="compose" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-1">
                <div className="relative overflow-hidden rounded-3xl bg-neutral-950 ring-1 ring-white/10">
                  {active?.kind === "video" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video key={active.id} src={active.display} className="max-h-72 w-full object-contain" autoPlay muted loop playsInline controls />
                  ) : active ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={active.id} src={active.display} alt="" className="max-h-72 w-full object-contain" />
                  ) : null}
                  <div className="absolute right-2.5 top-2.5 flex gap-1.5">
                    {active?.kind === "image" ? (
                      <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/70">
                        {active.display !== active.preview ? "Edit again" : "Edit"}
                      </button>
                    ) : null}
                  </div>
                  {isAlbum ? (
                    <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
                      {activeIdx + 1}/{items.length}
                    </span>
                  ) : null}
                </div>

                {/* Media rail — numbered tiles, remove, reorder; first = cover */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {items.map((it, i) => (
                    <div key={it.id} className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveIdx(i);
                          setEditing(false);
                        }}
                        aria-label={`Item ${i + 1}`}
                        className={cn(
                          "relative block h-16 w-16 overflow-hidden rounded-xl ring-2 transition",
                          i === activeIdx ? "ring-violet-500" : "ring-border/60 opacity-75 hover:opacity-100",
                        )}
                      >
                        {it.kind === "video" ? (
                          // eslint-disable-next-line jsx-a11y/media-has-caption
                          <video src={`${it.preview}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.display} alt="" className="h-full w-full object-cover" />
                        )}
                        <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/60 px-0.5 text-[9px] font-bold text-white">
                          {i + 1}
                        </span>
                        {i === 0 && isAlbum ? (
                          <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[8px] font-semibold text-white">Cover</span>
                        ) : null}
                      </button>
                      {items.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeItem(it.id)}
                          aria-label={`Remove item ${i + 1}`}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow"
                        >
                          <X className="h-3 w-3" strokeWidth={3} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {items.length < MAX_ITEMS ? (
                    <button
                      type="button"
                      onClick={() => galleryRef.current?.click()}
                      aria-label="Add more"
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-border/80 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  ) : null}
                </div>

                {/* Reorder the active item (item 1 is the cover) */}
                {isAlbum ? (
                  <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => moveActive(-1)}
                      disabled={activeIdx === 0}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 transition hover:bg-secondary disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Move left
                    </button>
                    <span>Item {activeIdx + 1}</span>
                    <button
                      type="button"
                      onClick={() => moveActive(1)}
                      disabled={activeIdx === items.length - 1}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 transition hover:bg-secondary disabled:opacity-40"
                    >
                      Move right <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}

                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={300}
                  placeholder="Say something about it…"
                  className="h-12 w-full rounded-2xl bg-background px-4 text-sm text-foreground outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                />

                {/* Destination */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Share to</p>
                  <div className={cn("grid gap-2", DEST.length === 3 ? "grid-cols-3" : DEST.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
                    {DEST.map((d) => {
                      const isActive = destination === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDestination(d.id)}
                          aria-pressed={isActive}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center transition",
                            isActive
                              ? "border-transparent bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25"
                              : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <d.icon className="h-4 w-4" />
                          <span className="text-sm font-semibold">{d.label}</span>
                          <span className={cn("text-[10px] leading-tight", isActive ? "text-white/80" : "text-muted-foreground")}>{d.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {err ? <p className="text-sm text-rose-400">{err}</p> : null}

                <button
                  type="button"
                  onClick={publish}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3.5 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {busy
                    ? (busyText ?? "Publishing…")
                    : destination === "story"
                      ? "Share to Story"
                      : destination === "both"
                        ? "Post + Story"
                        : destination === "reel"
                          ? isAlbum
                            ? `Share Reel · ${items.length} videos`
                            : "Share Reel"
                          : isAlbum
                            ? `Share Now · ${items.length} items`
                            : "Post now"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
