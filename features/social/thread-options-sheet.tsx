"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, ChevronRight, Clock, Image as ImageIcon, Loader2, Palette, Trash2, User, UserCircle, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { CONVERSATION_THEMES, type ConversationTheme } from "@/lib/social/message-meta";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";

const THEME_SWATCH: Record<ConversationTheme, string> = {
  blue: "bg-blue-500",
  pink: "bg-pink-500",
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  purple: "bg-violet-500",
};

const DISAPPEAR_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: "Off", seconds: null },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
];

/** Staggered entrance for each section (owner ask: "make the menu... feel alive"). */
const SHEET_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

/**
 * A brand-new service-worker install races `clients.claim()` against
 * whatever fetch the page happens to be mid-flight on — a well-known browser
 * quirk, confirmed here directly (blocking service workers in a real test
 * made the exact same PATCH succeed instantly every time; with the worker
 * enabled, the very first PATCH after a fresh load threw a raw network
 * `TypeError` even though the server never saw the request). One immediate
 * retry costs nothing once the worker has settled (which happens fast: this
 * fires again before the next paint) and turns a real save into a silent
 * success instead of "Couldn't save that change."
 */
async function patchWithRetry(url: string, body: Record<string, unknown>): Promise<Response> {
  const send = () =>
    fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    return await send();
  } catch {
    return send();
  }
}

/**
 * The "…" menu for a DIRECT thread (owner mockup) — groups already have
 * `ThreadHeaderMenu` → `GroupMembersSheet`; this is the direct-thread
 * equivalent: view profile, Chat Theme, Disappearing Messages (+ the new
 * Custom option the mockup adds, alongside the existing Off/24h/7d/30d — the
 * backend for all four already worked, just never exposed outside Secret
 * Chats), and the per-user Delete-conversation hide from the inbox swipe
 * action, reachable from inside the thread too.
 */
export function ThreadOptionsSheet({
  conversationId,
  otherHandle,
  otherName,
  otherAvatarUrl,
  otherIsVerified = false,
  initialTheme,
  initialWallpaperUrl,
  initialDisappearAfterSeconds,
  open,
  onClose,
}: {
  conversationId: string;
  otherHandle: string;
  otherName?: string;
  otherAvatarUrl?: string | null;
  otherIsVerified?: boolean;
  initialTheme: ConversationTheme | null;
  initialWallpaperUrl: string | null;
  initialDisappearAfterSeconds: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Owner report: "avoid the page overflowing when the button is clicked" —
  // this sheet never locked body scroll while open, unlike every other
  // fullscreen viewer/sheet in the app (see lib/dom/scroll-lock.ts's own doc
  // comment on the convention) — the thread underneath could still scroll
  // via touch behind the open sheet, reading as the page "overflowing."
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [open]);

  const [theme, setTheme] = useState(initialTheme);
  const [wallpaperUrl, setWallpaperUrl] = useState(initialWallpaperUrl);
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);
  const [disappearAfter, setDisappearAfter] = useState(initialDisappearAfterSeconds);
  const [customDays, setCustomDays] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await patchWithRetry(`/api/conversations/${conversationId}`, body);
      if (!res.ok) toast("Couldn't save that change.", "error");
      else router.refresh();
    } catch {
      toast("Couldn't save that change.", "error");
    } finally {
      setBusy(false);
    }
  };

  const applyTheme = (next: ConversationTheme | null) => {
    haptic("light");
    setTheme(next);
    void patch({ theme: next });
  };

  const pickWallpaper = () => wallpaperInputRef.current?.click();

  const onWallpaperFile = async (file: File | undefined) => {
    if (!file) return;
    haptic("light");
    setUploadingWallpaper(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const url = await uploadPostMedia({ data: file, kind: "image", ext, contentType: file.type || "image/jpeg" });
      setWallpaperUrl(url);
      await patch({ wallpaperUrl: url });
    } catch {
      toast("Couldn't upload that picture. Try a smaller image.", "error");
    } finally {
      setUploadingWallpaper(false);
    }
  };

  const removeWallpaper = () => {
    haptic("light");
    setWallpaperUrl(null);
    void patch({ wallpaperUrl: null });
  };

  const applyDisappear = (seconds: number | null) => {
    haptic("light");
    setDisappearAfter(seconds);
    setShowCustom(false);
    void patch({ disappearAfterSeconds: seconds });
  };

  const applyCustomDays = () => {
    const days = Number(customDays);
    if (!Number.isFinite(days) || days <= 0) return;
    applyDisappear(Math.round(days * 86_400));
    setCustomDays("");
  };

  const deleteConversation = async () => {
    if (!window.confirm("Delete this conversation? It'll come back if there's new activity.")) return;
    haptic("selection");
    setBusy(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      if (res.ok) {
        onClose();
        router.push("/messages");
      } else {
        toast("Couldn't delete this conversation.", "error");
      }
    } catch {
      toast("Couldn't delete this conversation.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Conversation options">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.35)] sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Drag handle — the standard "this is a sheet, swipe-adjacent"
                affordance every premium bottom sheet (WhatsApp/Snapchat/iOS)
                carries; this one never had it. */}
            <div className="flex justify-center pb-1 pt-2.5">
              <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/15" />
            </div>
            <motion.button
              type="button"
              onClick={onClose}
              aria-label="Close"
              whileTap={{ scale: 0.88 }}
              transition={springs.press}
              className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-secondary/80 text-muted-foreground backdrop-blur transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </motion.button>

            {/* Identity hero — WhatsApp/Snapchat contact-info style: the
                sheet is about THIS person's chat, not a generic settings
                list, so it leads with who they are, not a plain title bar. */}
            <div className="flex flex-col items-center gap-2 px-5 pb-5 pt-2 text-center">
              <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-tile shadow-[0_6px_20px_-6px] shadow-[hsl(var(--brand-purple)/0.5)] ring-4 ring-card">
                {otherAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={otherAvatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserCircle className="h-9 w-9 text-white/90" strokeWidth={1.5} />
                )}
              </span>
              <span className="flex items-center gap-1 text-base font-bold tracking-tight">
                {otherName || `@${otherHandle}`}
                {otherIsVerified ? <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-primary-foreground" /> : null}
              </span>
              <span className="text-xs text-muted-foreground">@{otherHandle}</span>
            </div>

            <motion.div
              className="space-y-3 px-5 pb-6 pt-2"
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
            >
              <motion.div variants={SHEET_ITEM_VARIANTS}>
                <Link
                  href={`/u/${otherHandle}`}
                  onClick={onClose}
                  className="flex items-center justify-between rounded-2xl bg-card px-4 py-3.5 text-sm font-semibold shadow-sm ring-1 ring-border/50 transition active:scale-[0.98] hover:bg-secondary/40"
                >
                  <span className="flex items-center gap-3">
                    <ModuleIconBadge icon={User} className="h-9 w-9 rounded-xl" /> View profile
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </motion.div>

              <motion.div variants={SHEET_ITEM_VARIANTS} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/50">
                <p className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
                  <ModuleIconBadge icon={Palette} className="h-9 w-9 rounded-xl" /> Chat theme
                </p>
                <div className="flex items-center gap-3.5">
                  <motion.button
                    type="button"
                    disabled={busy}
                    onClick={() => applyTheme(null)}
                    aria-label="Default theme"
                    whileTap={{ scale: 0.88 }}
                    animate={theme === null ? { scale: 1.08 } : { scale: 1 }}
                    transition={springs.bounce}
                    className={cn(
                      "relative flex h-11 w-11 items-center justify-center rounded-full bg-secondary ring-2 ring-offset-2 ring-offset-card transition",
                      theme === null ? "shadow-lg shadow-foreground/20 ring-foreground" : "ring-transparent",
                    )}
                  >
                    {theme === null ? <Check className="h-4 w-4" /> : null}
                  </motion.button>
                  {CONVERSATION_THEMES.map((t) => (
                    <motion.button
                      key={t}
                      type="button"
                      disabled={busy}
                      onClick={() => applyTheme(t)}
                      aria-label={`${t} theme`}
                      whileTap={{ scale: 0.88 }}
                      animate={theme === t ? { scale: 1.08 } : { scale: 1 }}
                      transition={springs.bounce}
                      className={cn(
                        "relative flex h-11 w-11 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card transition",
                        THEME_SWATCH[t],
                        theme === t ? "shadow-lg shadow-foreground/20 ring-foreground" : "ring-transparent",
                      )}
                    >
                      {theme === t ? <Check className="h-4 w-4 text-white" /> : null}
                    </motion.button>
                  ))}
                </div>
              </motion.div>

              <motion.div variants={SHEET_ITEM_VARIANTS} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/50">
                <p className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
                  <ModuleIconBadge icon={ImageIcon} className="h-9 w-9 rounded-xl" /> Chat wallpaper
                </p>
                <div className="flex items-center gap-3.5">
                  <motion.button
                    type="button"
                    disabled={busy || uploadingWallpaper}
                    onClick={pickWallpaper}
                    whileTap={{ scale: 0.94 }}
                    transition={springs.press}
                    className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border/60 bg-secondary/30 text-muted-foreground shadow-sm transition hover:bg-secondary/50 disabled:opacity-50"
                  >
                    {wallpaperUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={wallpaperUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6" />
                    )}
                    {uploadingWallpaper ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="h-5 w-5 animate-spin text-white" />
                      </span>
                    ) : null}
                  </motion.button>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                      {wallpaperUrl ? "Custom picture set for this chat." : "Use a picture as this chat's background."}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={busy || uploadingWallpaper}
                        onClick={pickWallpaper}
                        className="text-xs font-semibold text-primary disabled:opacity-50"
                      >
                        {wallpaperUrl ? "Change" : "Upload"}
                      </button>
                      {wallpaperUrl ? (
                        <button
                          type="button"
                          disabled={busy || uploadingWallpaper}
                          onClick={removeWallpaper}
                          className="text-xs font-semibold text-red-500 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onWallpaperFile(e.target.files?.[0])}
                />
              </motion.div>

              <motion.div variants={SHEET_ITEM_VARIANTS} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/50">
                <p className="mb-3 flex items-center gap-2.5 text-sm font-semibold">
                  <ModuleIconBadge icon={Clock} className="h-9 w-9 rounded-xl" /> Disappearing messages
                </p>
                {/* Icon-on-top cards in a single row (owner mockup) — was a
                    2-column grid of horizontal pill buttons, a structurally
                    different layout from the reference image. */}
                <div className="grid grid-cols-5 gap-1.5">
                  {DISAPPEAR_OPTIONS.map((o) => {
                    const active = disappearAfter === o.seconds;
                    return (
                      <motion.button
                        key={o.label}
                        type="button"
                        disabled={busy}
                        onClick={() => applyDisappear(o.seconds)}
                        whileTap={{ scale: 0.92 }}
                        transition={springs.press}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center text-[11px] font-medium transition",
                          active ? "border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/30" : "border-border/60 text-muted-foreground hover:bg-secondary/40",
                        )}
                      >
                        <Clock className="h-4 w-4" />
                        {o.label}
                      </motion.button>
                    );
                  })}
                  <motion.button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowCustom((v) => !v)}
                    whileTap={{ scale: 0.92 }}
                    transition={springs.press}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-center text-[11px] font-medium transition",
                      showCustom || (disappearAfter !== null && !DISAPPEAR_OPTIONS.some((o) => o.seconds === disappearAfter))
                        ? "border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/30"
                        : "border-border/60 text-muted-foreground hover:bg-secondary/40",
                    )}
                  >
                    <Clock className="h-4 w-4" />
                    Custom
                  </motion.button>
                </div>
                {showCustom ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      placeholder="Number of days"
                      className="w-full rounded-xl border border-border/60 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      type="button"
                      onClick={applyCustomDays}
                      disabled={busy || !customDays}
                      className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                ) : null}
              </motion.div>

              <motion.button
                variants={SHEET_ITEM_VARIANTS}
                type="button"
                disabled={busy}
                onClick={() => void deleteConversation()}
                whileTap={{ scale: 0.98 }}
                transition={springs.press}
                className="flex w-full items-center gap-3 rounded-2xl bg-red-500/10 px-4 py-3.5 text-sm font-semibold text-red-500 shadow-sm ring-1 ring-red-500/20 transition hover:bg-red-500/15"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500 shadow-[0_3px_10px_-2px] shadow-red-500/40 ring-1 ring-inset ring-white/10">
                  <Trash2 className="h-4 w-4 text-white" />
                </span>
                Delete conversation
              </motion.button>
            </motion.div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
