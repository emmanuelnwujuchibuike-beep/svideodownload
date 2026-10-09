"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Check, ChevronRight, Clock, Coins, Image as ImageIcon, Loader2, Palette, ShieldBan, Sparkles, Trash2, User, UserCircle, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamicImport from "next/dynamic";

import { BlockOptionsSheet } from "@/features/social/block-options-sheet";
import { ChatAppearanceSheet } from "@/features/social/chat-appearance-sheet";
import { setChatAppearance, useChatAppearance } from "@/features/social/use-chat-appearance";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import {
  WALLPAPER_SCOPES,
  WALLPAPER_SCOPE_HINT,
  WALLPAPER_SCOPE_LABEL,
  type WallpaperScope,
} from "@/lib/social/chat-appearance";
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
// the send sheet loads only when Send credits is tapped (2026-10-07)
const ChatSendCredits = dynamicImport(() => import("@/features/ai/wallet/chat-send-credits").then((m) => m.ChatSendCredits), { ssr: false });

export function ThreadOptionsSheet({
  conversationId,
  otherUserId,
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
  /** Present for direct/secret threads — gates the Block/restrict + Chat
   *  appearance rows (blocking is a 1:1 relationship; group threads use
   *  ThreadHeaderMenu instead, which doesn't render this sheet at all). */
  otherUserId?: string;
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
  // The SHARED ("Both of you") wallpaper — conversations.wallpaper_url.
  const [sharedWallpaperUrl, setSharedWallpaperUrl] = useState(initialWallpaperUrl);
  // The viewer's PERSONAL ("Only you") wallpaper, live from the same
  // per-conversation appearance row the font/bubble settings use.
  const appearance = useChatAppearance(conversationId);
  const personalWallpaperUrl = appearance.wallpaperUrl;
  // Owner ask (2026-07-16): choose where a wallpaper displays — "both chat and
  // only you". Defaults to whichever scope already has one set, so reopening
  // the sheet shows the picture you're actually looking at rather than
  // silently pointing at the empty scope.
  const [scope, setScope] = useState<WallpaperScope>(personalWallpaperUrl ? "me" : "both");
  const wallpaperUrl = scope === "me" ? personalWallpaperUrl : sharedWallpaperUrl;
  const [uploadingWallpaper, setUploadingWallpaper] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement | null>(null);
  const [disappearAfter, setDisappearAfter] = useState(initialDisappearAfterSeconds);
  const [customDays, setCustomDays] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockSheetOpen, setBlockSheetOpen] = useState(false);
  const [sendCreditsOpen, setSendCreditsOpen] = useState(false);
  const closeSendCredits = useCallback(() => setSendCreditsOpen(false), []);
  const [appearanceSheetOpen, setAppearanceSheetOpen] = useState(false);

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

  /** Save a wallpaper (or clear it with `null`) into the CURRENTLY selected
   *  scope. "Both of you" writes the shared conversation column; "Only you"
   *  writes the viewer's own per-chat appearance row — the two scopes are
   *  independent, so setting one never disturbs the other. */
  const saveWallpaper = async (url: string | null) => {
    if (scope === "me") {
      // Optimistic + rolls back itself on failure, and repaints the open thread
      // immediately through the shared appearance cache.
      await setChatAppearance(conversationId, { wallpaperUrl: url });
      return;
    }
    setSharedWallpaperUrl(url);
    await patch({ wallpaperUrl: url });
  };

  const onWallpaperFile = async (file: File | undefined) => {
    if (!file) return;
    haptic("light");
    setUploadingWallpaper(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const url = await uploadPostMedia({ data: file, kind: "image", ext, contentType: file.type || "image/jpeg" });
      await saveWallpaper(url);
    } catch {
      toast("Couldn't upload that picture. Try a smaller image.", "error");
    } finally {
      setUploadingWallpaper(false);
    }
  };

  const removeWallpaper = () => {
    haptic("light");
    void saveWallpaper(null);
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
  /*
    2026-10-09 (owner: "upgrade this chat option … to take the current Frenz AI and
    balance design … very professional, premium and light without excessive
    JavaScript execution"). The credits page's language: a gradient identity hero,
    bg-card/95 cards with small uppercase labels and gradient icon tiles,
    segmented controls. Only the sheet's own slide is animated by JS. Every press
    is CSS (active:scale), and the sheet is solid (no full-sheet backdrop blur).
  */
  const card = "rounded-2xl bg-card/95 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10";
  const row = "flex w-full items-center gap-3 px-4 py-3.5 text-left text-[14px] font-semibold transition active:scale-[0.99] active:bg-secondary/60 motion-reduce:active:scale-100";
  const seg = (on: boolean) =>
    cn(
      "min-h-[2.5rem] rounded-xl px-0.5 text-[12px] font-semibold min-[360px]:px-2 min-[360px]:text-[12.5px] transition active:scale-95 disabled:opacity-50 motion-reduce:active:scale-100",
      on ? "bg-card text-indigo-700 shadow-[0_4px_12px_-6px_rgb(79_70_229/0.5)] ring-1 ring-inset ring-indigo-500/30 dark:text-indigo-300" : "text-muted-foreground",
    );
  const customActive = showCustom || (disappearAfter !== null && !DISAPPEAR_OPTIONS.some((o) => o.seconds === disappearAfter));
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div key="sheet" className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Conversation options">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[1.75rem] bg-background shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.35)] sm:bottom-6 sm:rounded-[1.75rem]"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex justify-center pb-1 pt-2.5">
              <span aria-hidden className="h-1.5 w-10 rounded-full bg-foreground/15" />
            </div>

            <div className="space-y-3 px-4 pb-6 pt-1.5">
              {/* ── who this chat is with — the credits hero's gradient ── */}
              <section className="relative overflow-hidden rounded-[1.6rem] bg-[linear-gradient(135deg,#1d4ed8_0%,#4f46e5_55%,#a21caf_100%)] p-4 text-white shadow-[0_24px_48px_-28px_rgba(79,70,229,0.75)]">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-inset ring-white/25 transition active:scale-90 motion-reduce:active:scale-100"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-3 pr-10">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/15 ring-2 ring-white/60">
                    {otherAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={otherAvatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <UserCircle className="h-8 w-8 text-white/90" strokeWidth={1.5} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-[17px] font-bold tracking-[-0.02em]">
                      <span className="truncate">{otherName || `@${otherHandle}`}</span>
                      {otherIsVerified ? <BadgeCheck className="h-4 w-4 shrink-0 fill-white text-indigo-600" /> : null}
                    </span>
                    <span className="block truncate text-[12.5px] text-white/70">@{otherHandle}</span>
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/u/${otherHandle}`}
                    onClick={onClose}
                    className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-white px-4 text-[13.5px] font-bold text-indigo-700 shadow-sm transition active:scale-95 motion-reduce:active:scale-100"
                  >
                    <User className="h-4 w-4" aria-hidden />
                    View profile
                  </Link>
                  {otherUserId ? (
                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        setSendCreditsOpen(true);
                      }}
                      className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full px-4 text-[13.5px] font-semibold text-white ring-1 ring-inset ring-white/35 transition active:scale-95 active:bg-white/10 motion-reduce:active:scale-100"
                    >
                      <Coins className="h-4 w-4" aria-hidden />
                      Send credits
                    </button>
                  ) : null}
                </div>
              </section>

              {/* ── chat theme ── */}
              <section className={cn(card, "p-4")}>
                <SectionLabel icon={Palette}>Chat theme</SectionLabel>
                <div className="mt-3 grid grid-cols-6 justify-items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => applyTheme(null)}
                    aria-label="Default theme"
                    aria-pressed={theme === null}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full min-[360px]:h-10 min-[360px]:w-10 bg-secondary ring-2 ring-offset-2 ring-offset-card transition active:scale-90 motion-reduce:active:scale-100",
                      theme === null ? "scale-105 ring-indigo-500" : "ring-transparent",
                    )}
                  >
                    {theme === null ? <Check className="h-4 w-4" /> : null}
                  </button>
                  {CONVERSATION_THEMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={busy}
                      onClick={() => applyTheme(t)}
                      aria-label={`${t} theme`}
                      aria-pressed={theme === t}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full min-[360px]:h-10 min-[360px]:w-10 ring-2 ring-offset-2 ring-offset-card transition active:scale-90 motion-reduce:active:scale-100",
                        THEME_SWATCH[t],
                        theme === t ? "scale-105 ring-indigo-500" : "ring-transparent",
                      )}
                    >
                      {theme === t ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                  ))}
                </div>
              </section>

              {/* ── wallpaper: two independent pictures, chosen by scope (owner, 2026-07-16) ── */}
              <section className={cn(card, "p-4")}>
                <SectionLabel icon={ImageIcon}>Chat wallpaper</SectionLabel>
                <div role="radiogroup" aria-label="Who sees the wallpaper" className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-secondary/70 p-1">
                  {WALLPAPER_SCOPES.map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      role="radio"
                      aria-checked={scope === sc}
                      onClick={() => {
                        haptic("selection");
                        setScope(sc);
                      }}
                      className={seg(scope === sc)}
                    >
                      {WALLPAPER_SCOPE_LABEL[sc]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-muted-foreground">{WALLPAPER_SCOPE_HINT[scope]}</p>
                <div className="mt-3 flex items-center gap-3.5">
                  <button
                    type="button"
                    disabled={busy || uploadingWallpaper}
                    onClick={pickWallpaper}
                    aria-label={wallpaperUrl ? "Change wallpaper" : "Upload wallpaper"}
                    className="relative flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-secondary/60 text-muted-foreground ring-1 ring-inset ring-border/60 transition active:scale-95 disabled:opacity-50 motion-reduce:active:scale-100"
                  >
                    {wallpaperUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={wallpaperUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-6 w-6" />
                    )}
                    {uploadingWallpaper ? (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="h-5 w-5 animate-spin text-white motion-reduce:animate-none" />
                      </span>
                    ) : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-muted-foreground">
                      {wallpaperUrl
                        ? scope === "me"
                          ? "Your own background for this chat."
                          : "Shared background — you both see it."
                        : scope === "me"
                          ? "Set a background only you can see."
                          : "Set a background you both see."}
                      {scope === "both" && personalWallpaperUrl ? " Your own picture is showing instead." : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || uploadingWallpaper}
                        onClick={pickWallpaper}
                        className="inline-flex min-h-[2.25rem] items-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 px-3.5 text-[12.5px] font-semibold text-white transition active:scale-95 disabled:opacity-50 motion-reduce:active:scale-100"
                      >
                        {wallpaperUrl ? "Change" : "Upload"}
                      </button>
                      {wallpaperUrl ? (
                        <button
                          type="button"
                          disabled={busy || uploadingWallpaper}
                          onClick={removeWallpaper}
                          className="inline-flex min-h-[2.25rem] items-center rounded-full px-3 text-[12.5px] font-semibold text-rose-600 transition active:scale-95 disabled:opacity-50 motion-reduce:active:scale-100"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
                <input ref={wallpaperInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onWallpaperFile(e.target.files?.[0])} />
              </section>

              {/* ── disappearing messages ── */}
              <section className={cn(card, "p-4")}>
                <SectionLabel icon={Clock}>Disappearing messages</SectionLabel>
                <div role="radiogroup" aria-label="Disappearing messages" className="mt-3 grid grid-cols-5 gap-1 rounded-2xl bg-secondary/70 p-1">
                  {DISAPPEAR_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      role="radio"
                      aria-checked={!customActive && disappearAfter === o.seconds}
                      disabled={busy}
                      onClick={() => applyDisappear(o.seconds)}
                      className={seg(!customActive && disappearAfter === o.seconds)}
                    >
                      {o.label === "24 hours" ? "24h" : o.label === "7 days" ? "7d" : o.label === "30 days" ? "30d" : o.label}
                    </button>
                  ))}
                  <button type="button" role="radio" aria-checked={customActive} disabled={busy} onClick={() => setShowCustom((v) => !v)} className={seg(customActive)}>
                    Custom
                  </button>
                </div>
                {showCustom ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      placeholder="Number of days"
                      className="h-11 w-full rounded-2xl border border-border/70 bg-background px-4 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    />
                    <button
                      type="button"
                      onClick={applyCustomDays}
                      disabled={busy || !customDays}
                      className="h-11 shrink-0 rounded-full bg-foreground px-5 text-[13.5px] font-semibold text-background transition active:scale-95 disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                ) : null}
              </section>

              {/* ── the rest, as one list ── */}
              <section className={cn(card, "divide-y divide-border/60 overflow-hidden")}>
                {/* per-VIEWER appearance across every chat (owner, 2026-07-14) — not the shared theme above */}
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setAppearanceSheetOpen(true);
                  }}
                  className={row}
                >
                  <IconTile icon={Sparkles} />
                  Font style &amp; bubble style
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                </button>
                {otherUserId ? (
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setBlockSheetOpen(true);
                    }}
                    className={row}
                  >
                    <IconTile icon={ShieldBan} tone="slate" />
                    Block or restrict
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </button>
                ) : null}
                <button type="button" disabled={busy} onClick={() => void deleteConversation()} className={cn(row, "text-rose-600 disabled:opacity-50")}>
                  <IconTile icon={Trash2} tone="rose" />
                  Delete conversation
                </button>
              </section>
            </div>
          </motion.div>
        </div>
      ) : null}
      {otherUserId ? (
        <BlockOptionsSheet
          key="block"
          open={blockSheetOpen}
          onClose={() => setBlockSheetOpen(false)}
          otherUserId={otherUserId}
          otherHandle={otherHandle}
          otherName={otherName}
        />
      ) : null}
      <ChatAppearanceSheet key="appearance" conversationId={conversationId} open={appearanceSheetOpen} onClose={() => setAppearanceSheetOpen(false)} />
      {sendCreditsOpen && otherUserId ? (
        <ChatSendCredits
          key="send"
          recipient={{ userId: otherUserId, name: otherName || (otherHandle ? `@${otherHandle}` : "Frenz member"), handle: otherHandle ?? null, avatarUrl: otherAvatarUrl ?? null }}
          onClose={closeSendCredits}
        />
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

type LucideIcon = typeof Palette;

/** A section's small uppercase label with its gradient tile — the credits page's card heading. */
function SectionLabel({ icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5">
      <IconTile icon={icon} small />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</span>
    </p>
  );
}

function IconTile({ icon: Icon, tone = "brand", small = false }: { icon: LucideIcon; tone?: "brand" | "slate" | "rose"; small?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl text-white",
        small ? "h-7 w-7 rounded-lg" : "h-9 w-9",
        tone === "brand" ? "bg-gradient-to-br from-blue-600 to-violet-500" : tone === "rose" ? "bg-rose-500" : "bg-slate-700 dark:bg-slate-600",
      )}
    >
      <Icon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden />
    </span>
  );
}
