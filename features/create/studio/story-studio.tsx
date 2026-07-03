"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Heading1,
  Image as ImageIcon,
  Loader2,
  Minus,
  Plus,
  Quote,
  Sparkles,
  Trash2,
  Type,
  Video as VideoIcon,
  Wand2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { closeStudio, useStudioOpen } from "@/features/create/studio/studio-store";
import { captureVideoPoster } from "@/lib/media/video-poster";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "frenz:studio-draft-v1";
const MAX_BYTES = 100 * 1024 * 1024;

type BlockType = "heading" | "text" | "quote" | "image" | "video" | "divider";
interface Block {
  id: string;
  type: BlockType;
  text?: string;
  url?: string | null;
  poster?: string | null;
  uploading?: boolean;
}

const MOODS = [
  { id: "friendly", label: "Friendly", grad: "from-blue-500 to-violet-500" },
  { id: "pro", label: "Professional", grad: "from-slate-500 to-blue-600" },
  { id: "funny", label: "Funny", grad: "from-amber-500 to-rose-500" },
  { id: "inspo", label: "Inspiring", grad: "from-violet-500 to-fuchsia-500" },
  { id: "news", label: "Breaking", grad: "from-rose-500 to-orange-500" },
] as const;

const uid = () => Math.random().toString(36).slice(2, 9);
const freshBlocks = (): Block[] => [{ id: uid(), type: "text", text: "" }];

interface Draft {
  blocks: Block[];
  mood: string;
  savedAt: number;
}

export function StoryStudio() {
  const open = useStudioOpen();
  if (!open) return null;
  return <StudioInner />;
}

function StudioInner() {
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(freshBlocks);
  const [mood, setMood] = useState<string>("friendly");
  const [recover, setRecover] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState<"idle" | "working" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);

  // Smart recovery — offer to restore an unsaved draft on open.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        if (d.blocks?.some((b) => (b.text && b.text.trim()) || b.url)) setRecover(d);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Auto-save (debounced) — the backbone of smart recovery.
  useEffect(() => {
    if (recover) return; // don't overwrite until the user decides
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const hasContent = blocks.some((b) => (b.text && b.text.trim()) || b.url);
        if (hasContent) localStorage.setItem(DRAFT_KEY, JSON.stringify({ blocks, mood, savedAt: Date.now() } satisfies Draft));
      } catch {
        /* storage full/blocked */
      }
    }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [blocks, mood, recover]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  const close = () => closeStudio();

  const update = (id: string, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id: string) => setBlocks((bs) => (bs.length > 1 ? bs.filter((b) => b.id !== id) : bs));
  const move = (id: string, dir: -1 | 1) =>
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = (type: BlockType) => {
    if (type === "image") return imgInput.current?.click();
    if (type === "video") return vidInput.current?.click();
    setBlocks((bs) => [...bs, { id: uid(), type, text: "" }]);
  };

  const onPickMedia = async (e: React.ChangeEvent<HTMLInputElement>, kind: "image" | "video") => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) return setErr("File must be under 100 MB.");
    setErr(null);
    const id = uid();
    setBlocks((bs) => [...bs, { id, type: kind, url: null, uploading: true }]);
    try {
      let poster: string | undefined;
      if (kind === "video") {
        const blob = await captureVideoPoster(file).catch(() => null);
        if (blob) poster = await uploadPostMedia({ data: blob, kind: "image", ext: "jpg", contentType: "image/jpeg" }).catch(() => undefined);
      }
      const ext = (file.name.split(".").pop() || (kind === "video" ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
      const url = await uploadPostMedia({ data: file, kind, ext, contentType: file.type || (kind === "video" ? "video/mp4" : "image/jpeg") });
      update(id, { url, poster, uploading: false });
    } catch {
      setErr("Upload failed — try a smaller file.");
      remove(id);
    }
  };

  const publish = async () => {
    if (busy) return;
    if (blocks.some((b) => b.uploading)) {
      setErr("Hang on — media is still uploading.");
      return;
    }
    const media = blocks.find((b) => (b.type === "image" || b.type === "video") && b.url);
    if (!media) {
      setErr("Add a photo or video to publish (text-only posts are coming soon).");
      return;
    }
    const texts = blocks.filter((b) => b.type === "heading" || b.type === "text" || b.type === "quote").map((b) => (b.text ?? "").trim()).filter(Boolean);
    const heading = blocks.find((b) => b.type === "heading" && b.text?.trim());
    const title = (heading?.text || texts[0] || "New post").slice(0, 300);
    const description = texts.join("\n\n").slice(0, 5000) || null;

    setBusy(true);
    setPublishing("working");
    setErr(null);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: media.url,
          platform: "frenz",
          mediaKind: media.type,
          title,
          description,
          thumbnailUrl: media.type === "image" ? media.url : media.poster ?? null,
          visibility: "public",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't publish.");
        setPublishing("idle");
        return;
      }
      // Store the media so it plays natively (best-effort).
      if (json.id) void fetch(`/api/posts/${json.id}/store-media`, { method: "POST" }).catch(() => {});
      try {
        navigator.vibrate?.(18);
      } catch {
        /* no haptics */
      }
      setPublishing("done");
      clearDraft();
      setTimeout(() => {
        close();
        router.push(json.id ? `/p/${json.id}` : "/home");
        router.refresh();
      }, 1200);
    } catch {
      setErr("Network error.");
      setPublishing("idle");
    } finally {
      setBusy(false);
    }
  };

  const accent = MOODS.find((m) => m.id === mood)?.grad ?? "from-blue-500 to-violet-500";

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Story Studio">
      <input ref={imgInput} type="file" accept="image/*" className="sr-only" onChange={(e) => onPickMedia(e, "image")} />
      <input ref={vidInput} type="file" accept="video/*" className="sr-only" onChange={(e) => onPickMedia(e, "video")} />

      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div aria-hidden className={cn("pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-gradient-to-br opacity-30 blur-3xl", accent)} />
        <button type="button" onClick={close} aria-label="Close" className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary">
          <X className="h-5 w-5" />
        </button>
        <h2 className="relative flex items-center gap-2 text-sm font-bold tracking-tight">
          <Wand2 className="h-4 w-4 text-foreground" /> <span className="text-gradient">Story Studio</span>
        </h2>
        <PublishButtonMorph phase={publishing} disabled={busy} accent={accent} onClick={publish} />
      </header>

      {/* Smart recovery banner */}
      <AnimatePresence>
        {recover ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-border/60 bg-gradient-to-r from-blue-600/10 to-violet-600/10">
            <div className="flex items-center gap-3 px-4 py-3">
              <Sparkles className="h-4 w-4 shrink-0 text-foreground" />
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">Recover your draft?</span>{" "}
                <span className="text-muted-foreground">You have unsaved work from {new Date(recover.savedAt).toLocaleString()}.</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setBlocks(recover.blocks.map((b) => ({ ...b, uploading: false })));
                  setMood(recover.mood || "friendly");
                  setRecover(null);
                }}
                className="shrink-0 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecover(null);
                  clearDraft();
                }}
                className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Discard
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Mood */}
      <div className="flex gap-2 overflow-x-auto border-b border-border/60 px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 self-center pr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mood</span>
        {MOODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMood(m.id)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition",
              mood === m.id ? `bg-gradient-to-r ${m.grad} text-white shadow-sm` : "border border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-2 overflow-y-auto px-4 py-5">
        {blocks.map((b, i) => (
          <BlockEditor key={b.id} block={b} first={i === 0} last={i === blocks.length - 1} onChange={(t) => update(b.id, { text: t })} onMove={(d) => move(b.id, d)} onRemove={() => remove(b.id)} />
        ))}

        {err ? <p className="pt-1 text-center text-sm text-rose-400">{err}</p> : null}

        {/* Add-block bar */}
        <div className="sticky bottom-0 mt-3 flex flex-wrap justify-center gap-2 rounded-2xl border border-border/60 bg-card/90 p-2 backdrop-blur">
          <AddBtn icon={Type} label="Text" onClick={() => add("text")} />
          <AddBtn icon={Heading1} label="Heading" onClick={() => add("heading")} />
          <AddBtn icon={Quote} label="Quote" onClick={() => add("quote")} />
          <AddBtn icon={ImageIcon} label="Photo" onClick={() => add("image")} />
          <AddBtn icon={VideoIcon} label="Video" onClick={() => add("video")} />
          <AddBtn icon={Minus} label="Divider" onClick={() => add("divider")} />
        </div>
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block;
  first: boolean;
  last: boolean;
  onChange: (t: string) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="group relative rounded-2xl px-1 py-0.5 transition hover:bg-secondary/30">
      {/* controls */}
      <div className="absolute right-1 top-1 z-10 flex gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <IconBtn icon={ArrowUp} label="Move up" disabled={first} onClick={() => onMove(-1)} />
        <IconBtn icon={ArrowDown} label="Move down" disabled={last} onClick={() => onMove(1)} />
        <IconBtn icon={Trash2} label="Delete" danger onClick={onRemove} />
      </div>

      {block.type === "divider" ? (
        <div className="py-4">
          <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>
      ) : block.type === "image" || block.type === "video" ? (
        <div className="relative overflow-hidden rounded-xl bg-neutral-950">
          {block.uploading ? (
            <div className="flex aspect-video items-center justify-center text-white/70">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : block.url ? (
            block.type === "video" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={block.url} poster={block.poster ?? undefined} controls playsInline className="max-h-80 w-full object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={block.url} alt="" className="max-h-80 w-full object-contain" />
            )
          ) : (
            <div className="flex aspect-video items-center justify-center text-white/40">Failed</div>
          )}
        </div>
      ) : (
        <textarea
          value={block.text ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={block.type === "heading" ? 1 : 2}
          placeholder={block.type === "heading" ? "Heading" : block.type === "quote" ? "Add a quote…" : "Write something…"}
          className={cn(
            "w-full resize-none bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground/50",
            block.type === "heading" && "text-2xl font-extrabold tracking-tight",
            block.type === "quote" && "border-l-2 border-violet-500/60 pl-4 italic text-muted-foreground",
            block.type === "text" && "text-[15px] leading-relaxed",
          )}
        />
      )}
    </div>
  );
}

function AddBtn({ icon: Icon, label, onClick }: { icon: typeof Type; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground">
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function IconBtn({ icon: Icon, label, onClick, disabled, danger }: { icon: typeof ArrowUp; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-card/90 text-muted-foreground ring-1 ring-border/60 backdrop-blur transition hover:text-foreground disabled:opacity-30", danger && "hover:text-rose-500")}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Publish button that morphs into a glowing energy sphere, then a success check. */
function PublishButtonMorph({ phase, disabled, accent, onClick }: { phase: "idle" | "working" | "done"; disabled: boolean; accent: string; onClick: () => void }) {
  if (phase === "done") {
    return (
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 px-3 text-sm font-bold text-white">
        <CheckCircle2 className="h-4 w-4" /> Posted
      </motion.div>
    );
  }
  if (phase === "working") {
    return (
      <motion.div layout className={cn("relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-white", accent)}>
        <motion.span aria-hidden className={cn("absolute inset-0 rounded-full bg-gradient-to-br blur-md", accent)} animate={{ opacity: [0.4, 0.9, 0.4], scale: [1, 1.25, 1] }} transition={{ duration: 1, repeat: Infinity }} />
        <Loader2 className="relative h-4 w-4 animate-spin" />
      </motion.div>
    );
  }
  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.95 }}
      className={cn("relative inline-flex h-9 items-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-r px-4 text-sm font-bold text-white shadow-md shadow-violet-500/25 disabled:opacity-60", accent)}
    >
      <Sparkles className="h-4 w-4" /> Publish
    </motion.button>
  );
}
