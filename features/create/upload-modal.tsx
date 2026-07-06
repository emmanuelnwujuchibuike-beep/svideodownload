"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Images,
  Layers,
  Loader2,
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

type Destination = "post" | "story" | "both";

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

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState<"image" | "video">("image");
  const [caption, setCaption] = useState("");
  const [destination, setDestination] = useState<Destination>(intent === "story" ? "story" : "post");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  // Studio photo editing is NON-DESTRUCTIVE: the original file + a parameter
  // object are kept, the edited pixels are baked only on Apply — so reopening
  // the editor resumes the exact same sliders over the original.
  const [original, setOriginal] = useState<File | null>(null);
  const [edit, setEdit] = useState<PhotoEdit>(NEUTRAL_EDIT);
  const [editing, setEditing] = useState(false);
  const [editedPreview, setEditedPreview] = useState<string | null>(null);

  const close = () => {
    if (preview) URL.revokeObjectURL(preview);
    if (editedPreview) URL.revokeObjectURL(editedPreview);
    closeUpload();
  };

  const accept = (f: File | undefined | null) => {
    if (!f) return;
    const isVideo = f.type.startsWith("video/");
    const isImage = f.type.startsWith("image/");
    if (!isVideo && !isImage) return setErr("Please choose a photo or video.");
    if (f.size > MAX_BYTES) return setErr("File must be under 100 MB.");
    setErr(null);
    setFile(f);
    setOriginal(f);
    setEdit(NEUTRAL_EDIT);
    setEditing(false);
    if (editedPreview) URL.revokeObjectURL(editedPreview);
    setEditedPreview(null);
    setKind(isVideo ? "video" : "image");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    accept(f);
  };

  const publish = async () => {
    if (!file || busy) return;
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
      const ext = (file.name.split(".").pop() || (kind === "video" ? "mp4" : "jpg"))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      // Capture a cover from the video's first frame (in parallel with nothing —
      // done before the media upload so a slow encode doesn't delay it further).
      let posterBlob: Blob | null = null;
      if (kind === "video") {
        posterBlob = await captureVideoPoster(file).catch(() => null);
      }

      let mediaUrl: string;
      try {
        mediaUrl = await uploadPostMedia({
          data: file,
          kind,
          ext,
          contentType: file.type || (kind === "video" ? "video/mp4" : "image/jpeg"),
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload failed. Try a smaller file.");
        return;
      }

      // Upload the captured cover (best-effort — the post still publishes without it).
      let thumbnailUrl: string | undefined;
      if (posterBlob) {
        try {
          thumbnailUrl = await uploadPostMedia({
            data: posterBlob,
            kind: "image",
            ext: "jpg",
            contentType: "image/jpeg",
          });
        } catch {
          /* cover is optional */
        }
      }

      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl, mediaKind: kind, caption: caption.trim() || undefined, thumbnailUrl, destination }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't publish.");
        return;
      }
      const link = json.postId
        ? `${window.location.origin}/p/${json.postId}`
        : `${window.location.origin}/home`;
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

  const DEST: { id: Destination; label: string; icon: typeof Clock; hint: string }[] = [
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
            <span className="text-gradient">Create</span>
          </h3>
          <button type="button" onClick={close} aria-label="Close" className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <input ref={galleryRef} type="file" accept="image/*,video/*" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />
        <input ref={cameraRef} type="file" accept="video/*,image/*" capture="user" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />

        <div className="relative flex-1 overflow-y-auto px-5 pb-6">
          <AnimatePresence mode="wait">
            {doneUrl ? (
              <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="py-10 text-center">
                <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
                  <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
                </motion.div>
                <p className="mt-3 text-lg font-bold">
                  {destination === "story" ? "Shared to your Story" : destination === "both" ? "Posted & shared to Story" : "Posted 🎉"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {destination === "post" ? "It's live on your profile and the feed." : destination === "both" ? "Live on your profile; story vanishes in 24h." : "Your story disappears in 24 hours."}
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
            ) : !preview ? (
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
                  accept(e.dataTransfer.files?.[0]);
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
                  <p className="relative z-10 mt-0.5 text-xs text-muted-foreground">Drop a file, record, or pick from your gallery</p>
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
                <p className="mt-3 text-center text-[11px] text-muted-foreground">Photos & videos · up to 100 MB</p>
              </motion.div>
            ) : editing && original && preview ? (
              /* ── Studio photo editor (non-destructive) ─────────────────── */
              <PhotoEditor
                src={preview}
                original={original}
                initial={edit}
                onCancel={() => setEditing(false)}
                onApply={({ blob, edit: nextEdit }) => {
                  const edited = new File([blob], original.name.replace(/\.\w+$/, "") + "-edited.jpg", { type: "image/jpeg" });
                  setFile(edited);
                  setEdit(nextEdit);
                  if (editedPreview) URL.revokeObjectURL(editedPreview);
                  setEditedPreview(URL.createObjectURL(edited));
                  setEditing(false);
                }}
              />
            ) : (
              /* ── Compose ───────────────────────────────────────────────── */
              <motion.div key="compose" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pt-1">
                <div className="relative overflow-hidden rounded-3xl bg-neutral-950 ring-1 ring-white/10">
                  {kind === "video" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={preview} className="max-h-80 w-full object-contain" autoPlay muted loop playsInline controls />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={editedPreview ?? preview ?? undefined} alt="" className="max-h-80 w-full object-contain" />
                  )}
                  <div className="absolute right-2.5 top-2.5 flex gap-1.5">
                    {kind === "image" ? (
                      <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/70">
                        {editedPreview ? "Edit again" : "Edit"}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => galleryRef.current?.click()} className="rounded-lg bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/70">
                      Change
                    </button>
                  </div>
                </div>

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
                  <div className="grid grid-cols-3 gap-2">
                    {DEST.map((d) => {
                      const active = destination === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDestination(d.id)}
                          aria-pressed={active}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center transition",
                            active
                              ? "border-transparent bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25"
                              : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <d.icon className="h-4 w-4" />
                          <span className="text-sm font-semibold">{d.label}</span>
                          <span className={cn("text-[10px] leading-tight", active ? "text-white/80" : "text-muted-foreground")}>{d.hint}</span>
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
                  {busy ? "Publishing…" : destination === "story" ? "Share to Story" : destination === "both" ? "Post + Story" : "Post now"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
