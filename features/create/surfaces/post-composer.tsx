"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Globe2,
  Images,
  Loader2,
  Plus,
  Share2,
  Wand2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  POST_RULES,
  publishComposition,
  useCaptionDraft,
  useComposerMedia,
  useComposerScrollLock,
  type Destination,
} from "@/features/create/composer-core";
import { PhotoEditor } from "@/features/create/photo-editor";
import { openStudio } from "@/features/create/studio/studio-store";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * /create/post — the POST surface.
 *
 * Facebook-led, per the owner's "use facebook and instagram combine style
 * sheet": FB's composer skeleton (close + title + a Post pill in the header,
 * an author row with an audience chip, a borderless "What's on your mind"
 * field, and the signature "Add to your post" tray) carrying Instagram's
 * media craft (the numbered cover-first album rail, inline photo editing).
 *
 * This surface is deliberately LIGHT/theme-following and text-first — a post
 * can be written with no media at all is NOT true here (the API requires
 * media), but text leads the layout the way it does on Facebook. Reels and
 * Stories are dark, media-first surfaces and share none of this styling.
 */
export function PostComposer({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useComposerScrollLock();
  const media = useComposerMedia(POST_RULES);
  const { items, active, activeIdx, err } = media;
  const { caption, setCaption, clearDraft } = useCaptionDraft("post");

  const [alsoStory, setAlsoStory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

  const isAlbum = items.length > 1;
  const firstName = displayName.split(" ")[0] || displayName;
  // "Also share to your story" is single-media only — a story is one media by
  // definition, so an album can't fan out to one. Force it off if the
  // selection grows past one, otherwise a stale `true` would silently send
  // destination="both" and publish only the cover as the story.
  useEffect(() => {
    if (isAlbum) setAlsoStory(false);
  }, [isAlbum]);

  // Auto-grow the field the way Facebook's does, capped so the tray stays
  // reachable without scrolling on a small screen.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [caption]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    media.accept(e.target.files);
    e.target.value = "";
  };

  const destination: Destination = alsoStory && !isAlbum ? "both" : "post";

  const publish = async () => {
    if (items.length === 0 || busy) return;
    setBusy(true);
    media.setErr(null);
    haptic("selection");
    try {
      const res = await publishComposition({
        items,
        caption,
        destination,
        onProgress: setBusyText,
      });
      clearDraft();
      setDoneUrl(res.link);
      router.refresh();
    } catch (e) {
      media.setErr(e instanceof Error ? e.message : "Network error.");
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

  const leave = () => router.push("/home");

  if (doneUrl) {
    return (
      <CreateDone
        title={destination === "both" ? "Posted & shared to Story" : isAlbum ? "Your album is live" : "Posted"}
        subtitle={
          destination === "both"
            ? "Live on your profile; the story vanishes in 24h."
            : isAlbum
              ? "Swipe through it on your profile and the feed."
              : "It's live on your profile and the feed."
        }
        onShare={share}
        onCopy={() => navigator.clipboard?.writeText(doneUrl).catch(() => {})}
        onDone={leave}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
      {/* ── Header: FB's close + title + Post pill ─────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2.5">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full text-foreground transition hover:bg-secondary"
        >
          <X className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-[17px] font-bold tracking-tight">Create post</h1>
        <button
          type="button"
          onClick={publish}
          disabled={busy || items.length === 0}
          className={cn(
            "inline-flex h-9 min-w-[76px] items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold transition",
            items.length === 0 || busy
              ? "bg-secondary text-muted-foreground"
              : "bg-brand text-white shadow-sm shadow-violet-500/25 hover:opacity-95",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "" : "Post"}
        </button>
      </header>

      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />
      <input ref={cameraRef} type="file" accept="image/*,video/*" capture="environment" onChange={onPick} className="sr-only" aria-hidden tabIndex={-1} />

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          media.accept(e.dataTransfer.files);
        }}
      >
        {editing && active && active.kind === "image" ? (
          <div className="pt-3">
            <PhotoEditor
              src={active.preview}
              original={active.original}
              initial={active.edit}
              onCancel={() => setEditing(false)}
              onApply={({ blob, edit }) => {
                media.applyEdit(active.id, blob, edit);
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <>
            {/* Author row — FB's avatar + name + audience chip */}
            <div className="flex items-center gap-2.5 py-3">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                  {firstName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold leading-tight">{displayName}</p>
                <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  <Globe2 className="h-3 w-3" /> Public
                </span>
              </div>
            </div>

            {/* FB's borderless "What's on your mind" field */}
            <textarea
              ref={textRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder={`What's on your mind, ${firstName}?`}
              className="w-full resize-none bg-transparent text-lg leading-relaxed outline-none placeholder:text-muted-foreground"
            />

            {/* Media */}
            {items.length === 0 ? (
              <button
                type="button"
                onClick={() => galleryRef.current?.click()}
                className={cn(
                  "mt-2 flex h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition",
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border/80 hover:border-primary/60 hover:bg-secondary/40",
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                  <Images className="h-6 w-6 text-foreground" />
                </span>
                <span className="text-sm font-semibold">Add photos or videos</span>
                <span className="text-xs text-muted-foreground">or drag and drop</span>
              </button>
            ) : (
              <div className="mt-2 space-y-3">
                <div className="relative overflow-hidden rounded-2xl bg-neutral-950 ring-1 ring-border/60">
                  {active?.kind === "video" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video key={active.id} src={active.display} className="max-h-[42vh] w-full object-contain" autoPlay muted loop playsInline controls />
                  ) : active ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={active.id} src={active.display} alt="" className="max-h-[42vh] w-full object-contain" />
                  ) : null}

                  {active?.kind === "image" ? (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="absolute right-2.5 top-2.5 rounded-lg bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/70"
                    >
                      {active.display !== active.preview ? "Edit again" : "Edit"}
                    </button>
                  ) : null}
                  {isAlbum ? (
                    <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white backdrop-blur">
                      {activeIdx + 1}/{items.length}
                    </span>
                  ) : null}
                </div>

                {/* Cover-first album rail */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {items.map((it, i) => (
                    <div key={it.id} className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          media.setActiveIdx(i);
                          setEditing(false);
                        }}
                        aria-label={`Item ${i + 1}`}
                        className={cn(
                          "relative block h-16 w-16 overflow-hidden rounded-xl ring-2 transition",
                          i === activeIdx ? "ring-primary" : "ring-border/60 opacity-75 hover:opacity-100",
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
                      <button
                        type="button"
                        onClick={() => media.remove(it.id)}
                        aria-label={`Remove item ${i + 1}`}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow"
                      >
                        <X className="h-3 w-3" strokeWidth={3} />
                      </button>
                    </div>
                  ))}
                  {items.length < POST_RULES.maxItems ? (
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

                {isAlbum ? (
                  <div className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => media.move(-1)}
                      disabled={activeIdx === 0}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 transition hover:bg-secondary disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Move left
                    </button>
                    <span>Item {activeIdx + 1}</span>
                    <button
                      type="button"
                      onClick={() => media.move(1)}
                      disabled={activeIdx === items.length - 1}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1.5 transition hover:bg-secondary disabled:opacity-40"
                    >
                      Move right <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}

                {/* Cross-post to story — the one destination choice this
                    surface keeps (Reels/Stories have their own routes now). */}
                {!isAlbum ? (
                  <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border/60 bg-card/50 px-3.5 py-3">
                    <span className="text-sm font-medium">Also share to your story</span>
                    <input
                      type="checkbox"
                      checked={alsoStory}
                      onChange={(e) => setAlsoStory(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "relative h-5 w-9 rounded-full transition-colors",
                        alsoStory ? "bg-foreground" : "bg-border",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
                          alsoStory ? "translate-x-[1.15rem]" : "translate-x-0.5",
                        )}
                      />
                    </span>
                  </label>
                ) : null}
              </div>
            )}

            {err ? <p className="mt-3 text-sm text-rose-500">{err}</p> : null}
            {busyText ? <p className="mt-3 text-sm text-muted-foreground">{busyText}</p> : null}
          </>
        )}
      </div>

      {/* ── FB's "Add to your post" tray ──────────────────────────────────── */}
      {!editing ? (
        <div className="shrink-0 border-t border-border/60 bg-background px-3 pb-[max(env(safe-area-inset-bottom),0.6rem)] pt-2.5">
          <p className="px-1 pb-2 text-xs font-semibold text-muted-foreground">Add to your post</p>
          {/* Facebook tints these tray icons; this app doesn't any more — the
              same 2026-07-16 correction that stripped every colored icon block
              site-wide ("no background color … high icon contrast to be
              darker"). A blue camera here would be the exact thing that was
              just removed everywhere else. */}
          <div className="flex items-center gap-1">
            <TrayButton icon={Images} label="Photo/video" onClick={() => galleryRef.current?.click()} />
            <TrayButton icon={Camera} label="Camera" onClick={() => cameraRef.current?.click()} />
            <TrayButton
              icon={Wand2}
              label="Blocks"
              onClick={() => {
                openStudio();
                router.back();
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrayButton({ icon: Icon, label, onClick }: { icon: typeof Images; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-foreground transition hover:bg-secondary"
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

/** Shared success state. Layout only — each surface passes its own copy. */
export function CreateDone({
  title,
  subtitle,
  onShare,
  onCopy,
  onDone,
  dark = false,
}: {
  title: string;
  subtitle: string;
  onShare: () => void;
  onCopy: () => void;
  onDone: () => void;
  dark?: boolean;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center px-6 text-center",
        dark ? "bg-black text-white" : "bg-background text-foreground",
      )}
    >
      <AnimatePresence>
        <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
          </motion.div>
          <p className="mt-3 text-lg font-bold">{title}</p>
          <p className={cn("mt-1 text-sm", dark ? "text-white/70" : "text-muted-foreground")}>{subtitle}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={onShare} className="bg-brand inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white">
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button
              type="button"
              onClick={onCopy}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold",
                dark ? "border-white/20" : "border-border",
              )}
            >
              <Copy className="h-4 w-4" /> Copy link
            </button>
          </div>
          <button type="button" onClick={onDone} className={cn("mt-3 text-sm", dark ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground")}>
            Done
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
