"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Coins, Flag, Images, Loader2, Mail, Palette, Plus, Search, ShieldBan, Timer, Trash2, Type, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamicImport from "next/dynamic";

import { BlockOptionsSheet } from "@/features/social/block-options-sheet";
import { ChatAppearanceSheet } from "@/features/social/chat-appearance-sheet";
import { MessageSearchSheet } from "@/features/social/message-search-sheet";
import { PresenceLastSeen } from "@/features/social/presence-badge";
import { formatCredits } from "@/lib/ai/credits/units";
import { ReportSheet } from "@/features/social/report-sheet";
import { Avatar, VerifiedBadge } from "@/features/frenz-ui/primitives";
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
import type { ConversationTheme } from "@/lib/social/message-meta";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";
import { announceTypingRevoked } from "@/features/social/typing-privacy";

/* The swatch IS the sent-bubble colour (conversation-room THEME_BUBBLE_CLASS), so what you pick is what you get. */
const THEME_SWATCH: Record<ConversationTheme, string> = {
  blue: "bg-frenz-blue",
  pink: "bg-frenz-magenta",
  green: "bg-emerald-500",
  orange: "bg-orange-500",
  purple: "bg-frenz-violet",
  midnight: "bg-[linear-gradient(135deg,hsl(250_60%_29%),hsl(250_48%_8%))]",
  mono: "bg-[hsl(247_21%_8%)] dark:bg-white/25",
};

/* design/ChatMenu.dc.html: brand colours only, in its order. null is the app's default — the Frenz gradient. */
const PICKABLE_THEMES: (ConversationTheme | null)[] = [null, "blue", "purple", "pink", "midnight", "mono"];
const THEME_NAME: Record<ConversationTheme, string> = { blue: "Blue", pink: "Magenta", green: "Green", orange: "Orange", purple: "Violet", midnight: "Midnight", mono: "Mono" };

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
const loadSendCredits = () => import("@/features/ai/wallet/chat-send-credits");
const ChatSendCredits = dynamicImport(() => loadSendCredits().then((m) => m.ChatSendCredits), { ssr: false });
// 2026-10-14 (owner: "respond instantly like the promote button"): the sheet's code and the wallet read are
// warmed while this menu is idle, and kept for the tab, so the tap paints the sheet at once
const warmSendCredits = () => void loadSendCredits().then((m) => m.prefetchSendCredits()).catch(() => {});
/* "Media, links & files" (0264 day, 2026-10-19) — its own chunk, loaded when the row is tapped */
const ChatMediaSheet = dynamicImport(() => import("@/features/social/chat-media-sheet").then((m) => m.ChatMediaSheet), { ssr: false });


export function ThreadOptionsSheet({
  conversationId,
  otherUserId,
  otherHandle,
  otherName,
  otherAvatarUrl,
  otherBannerUrl: _otherBannerUrl = null,
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
  /** Their profile cover: the hero's background when set, the brand gradient otherwise (owner 2026-10-11). */
  otherBannerUrl?: string | null;
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
  useEffect(() => {
    if (!open || !otherUserId) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warmSendCredits);
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warmSendCredits, 300);
    return () => window.clearTimeout(t);
  }, [open, otherUserId]);
  // the real balance on the Send AI credits button — the same kept read the send sheet uses, so no second request
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !otherUserId) return;
    let live = true;
    void loadSendCredits()
      .then((m) => m.sendCreditsBalance())
      .then((b) => live && setBalance(b))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, otherUserId, sendCreditsOpen]);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [appearanceSheetOpen, setAppearanceSheetOpen] = useState(false);
  // ChatMenu.dc.html: the disappearing choice opens from its row; Report and Search are rows of their own
  const [disappearOpen, setDisappearOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

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
    design/ChatMenu.dc.html (owner, 2026-10-18; step 15, 2026-10-19): a GLASS sheet over the chat (there is
    a picture behind it — the thread and its wallpaper), the person (avatar with the identity ring, name,
    @handle · last seen, "View profile"), the gradient Send AI credits button with the real balance, brand
    swatches, wallpaper (scope and upload — no preset pictures: backgrounds stay plain white unless the owner
    says "emergency change", 2026-10-19), one list (Disappearing messages, Font & bubble style,
    Media, links & files, Search in chat, Email me new messages) and Block / Report as red rows. Every save
    path is the one this sheet already had; Media, links & files and the Midnight / Mono themes are new (0264).
  */
  const card = "rounded-[20px] border border-frenz-line bg-frenz-card";
  const row = "flex min-h-[56px] w-full items-center gap-3 px-3.5 text-left transition active:bg-frenz-fill disabled:opacity-50";
  const seg = (on: boolean) =>
    cn(
      "min-h-[38px] rounded-[9px] px-1 text-[13px] transition-colors disabled:opacity-50",
      on ? "bg-frenz-card font-bold text-frenz-ink shadow-[0_1px_3px_rgba(18,17,26,0.12)]" : "font-semibold text-frenz-muted",
    );
  const customActive = showCustom || (disappearAfter !== null && !DISAPPEAR_OPTIONS.some((o) => o.seconds === disappearAfter));
  const disappearLabel =
    disappearAfter === null ? "Off" : (DISAPPEAR_OPTIONS.find((o) => o.seconds === disappearAfter)?.label ?? `${Math.round(disappearAfter / 86_400)} days`);
  const name = otherName || `@${otherHandle}`;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div key="sheet" className="frenz-ui fixed inset-0 z-[110] text-frenz-ink" role="dialog" aria-modal="true" aria-label="Chat options">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/25"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="frenz-nav-glass frenz-nav-glass--sheet absolute inset-x-0 bottom-0 mx-auto max-h-[90vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-[28px] !border-x-0 !border-b-0 sm:bottom-6 sm:rounded-[28px] sm:!border"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex justify-center pb-1 pt-2">
              <span aria-hidden className="h-[5px] w-9 rounded-full bg-[#DCD9E6] dark:bg-white/20" />
            </div>

            <div className="px-4 pb-6">
              {/* ── who this chat is with ── */}
              <div className="flex items-start gap-3.5 pt-1">
                <Avatar src={otherAvatarUrl ?? null} name={name} size={60} ring />
                <div className="min-w-0 flex-1 pt-1">
                  <p className="m-0 flex items-center gap-1.5">
                    <span className="truncate font-heading text-[19px] font-bold">{name}</span>
                    {otherIsVerified ? <VerifiedBadge size={17} /> : null}
                  </p>
                  <p className="m-0 truncate text-sm text-frenz-muted">
                    @{otherHandle}
                    {otherUserId ? <PresenceLastSeen userId={otherUserId} /> : null}
                  </p>
                  <Link
                    href={`${profilePath(otherHandle)}`}
                    onClick={onClose}
                    className="mt-2 inline-flex min-h-9 items-center rounded-full bg-frenz-fill px-3.5 text-[13px] font-bold text-frenz-violet transition active:scale-95"
                  >
                    View profile
                  </Link>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
                    <X className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                </button>
              </div>

              {/* ── send AI credits ── */}
              {otherUserId ? (
                <button
                  type="button"
                  onPointerDown={warmSendCredits}
                  onClick={() => {
                    haptic("light");
                    setSendCreditsOpen(true);
                  }}
                  // the design's one full-width gradient action (a primary action — the gradient earns its place)
                  className="mt-4 flex w-full items-center gap-3 rounded-[20px] bg-frenz-gradient-x p-3.5 text-left text-white shadow-frenz-card transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2"
                >
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
                    <Coins className="h-5 w-5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-heading text-[15px] font-bold">Send AI credits</span>
                    <span className="truncate text-[13px] text-white/85">Gift credits to {name}</span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] leading-tight text-white/85">
                    Your balance
                    <span className="block text-[14px] font-bold tabular-nums text-white">{balance === null ? "—" : formatCredits(balance)}</span>
                  </span>
                </button>
              ) : null}

              {/* ── theme ── */}
              <div className="mt-5 flex items-baseline justify-between px-1">
                <h3 className="m-0 text-[13px] font-bold text-frenz-muted">Theme</h3>
                <span className="text-[13px] font-semibold text-frenz-muted">{theme ? THEME_NAME[theme] : "Frenz"}</span>
              </div>
              <div role="radiogroup" aria-label="Chat theme" className="mt-2 flex flex-wrap gap-2.5 px-1">
                {/* a theme no longer offered (green / orange) still shows while it is this chat's, so the state stays honest */}
                {(theme && !PICKABLE_THEMES.includes(theme) ? [...PICKABLE_THEMES, theme] : PICKABLE_THEMES).map((t) => {
                  const on = theme === t;
                  return (
                    <button
                      key={t ?? "default"}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${t ? THEME_NAME[t] : "Frenz"} theme`}
                      disabled={busy}
                      onClick={() => applyTheme(t)}
                      className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-50"
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-frenz-page transition",
                          t ? THEME_SWATCH[t] : "bg-frenz-gradient",
                          on ? "ring-frenz-violet" : "ring-transparent",
                        )}
                      >
                        {on ? <Check className="h-4 w-4 text-white" aria-hidden /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ── wallpaper: two independent pictures, chosen by scope (owner, 2026-07-16) ── */}
              <h3 className="m-0 mt-5 px-1 text-[13px] font-bold text-frenz-muted">Wallpaper</h3>
              <div role="radiogroup" aria-label="Who sees the wallpaper" className="mt-2 grid grid-cols-2 gap-0.5 rounded-xl bg-frenz-fill p-[3px]">
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
              <div className="mt-2.5 flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={busy || uploadingWallpaper}
                  onClick={pickWallpaper}
                  aria-label={wallpaperUrl ? "Change wallpaper" : "Upload wallpaper"}
                  className="relative flex h-[88px] w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-frenz-line bg-frenz-fill text-frenz-violet transition active:scale-95 disabled:opacity-50"
                >
                  {uploadingWallpaper ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Plus className="h-5 w-5" aria-hidden />}
                </button>
                {wallpaperUrl ? (
                  <span className="relative h-[88px] w-16 shrink-0 overflow-hidden rounded-2xl ring-2 ring-frenz-violet ring-offset-2 ring-offset-frenz-page">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the chat's own wallpaper */}
                    <img src={wallpaperUrl} alt="Current wallpaper" className="h-full w-full object-cover" />
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[12.5px] leading-snug text-frenz-muted">
                    {WALLPAPER_SCOPE_HINT[scope]}
                    {scope === "both" && personalWallpaperUrl ? " Your own picture is showing instead." : ""}
                  </p>
                  {wallpaperUrl ? (
                    <button type="button" disabled={busy || uploadingWallpaper} onClick={removeWallpaper} className="mt-1 min-h-9 text-[13px] font-bold text-rose-700 disabled:opacity-50 dark:text-rose-400">
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <input ref={wallpaperInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onWallpaperFile(e.target.files?.[0])} />

              {/* ── the list ── */}
              <ul className={cn(card, "mt-5 overflow-hidden")}>
                <li>
                  <button type="button" onClick={() => setDisappearOpen((o) => !o)} aria-expanded={disappearOpen} aria-controls="disappear-panel" className={row}>
                    <RowIcon icon={Timer} className="bg-frenz-blue" />
                    <span className="flex-1 text-base font-semibold">Disappearing messages</span>
                    <span className="text-sm text-frenz-muted">{disappearLabel}</span>
                    <ChevronRight className={cn("h-4 w-4 shrink-0 text-frenz-muted transition-transform", disappearOpen && "rotate-90")} aria-hidden />
                  </button>
                  <div id="disappear-panel" hidden={!disappearOpen} className="px-3.5 pb-3.5">
                    <div role="radiogroup" aria-label="Disappearing messages" className="grid grid-cols-5 gap-0.5 rounded-xl bg-frenz-fill p-[3px]">
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
                        <label htmlFor="disappear-days" className="sr-only">
                          Number of days
                        </label>
                        <input
                          id="disappear-days"
                          type="number"
                          min={1}
                          value={customDays}
                          onChange={(e) => setCustomDays(e.target.value)}
                          placeholder="Number of days"
                          className="h-11 w-full rounded-xl border-0 bg-frenz-fill px-4 text-[16px] outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet/40"
                        />
                        <button type="button" onClick={applyCustomDays} disabled={busy || !customDays} className="h-11 shrink-0 rounded-full bg-frenz-ink px-5 text-[14px] font-bold text-frenz-page disabled:opacity-50">
                          Set
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
                <li className="border-t border-frenz-line">
                  {/* per-VIEWER appearance across every chat (owner, 2026-07-14) — not the shared theme above */}
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setAppearanceSheetOpen(true);
                    }}
                    className={row}
                  >
                    <RowIcon icon={Type} className="bg-frenz-violet" />
                    <span className="flex-1 text-base font-semibold">Font &amp; bubble style</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
                  </button>
                </li>
                <li className="border-t border-frenz-line">
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setMediaOpen(true);
                    }}
                    className={row}
                  >
                    <RowIcon icon={Images} className="bg-frenz-magenta" />
                    <span className="flex-1 text-base font-semibold">Media, links &amp; files</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
                  </button>
                </li>
                <li className="border-t border-frenz-line">
                  {/* the existing message search, narrowed to this chat (the API's own scope) */}
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      setSearchOpen(true);
                    }}
                    className={row}
                  >
                    <RowIcon icon={Search} className="bg-frenz-ink dark:bg-white/20" />
                    <span className="flex-1 text-base font-semibold">Search in chat</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
                  </button>
                </li>
                <li className="border-t border-frenz-line">
                  <MessageEmailRow />
                </li>
              </ul>

              {/* ── block / report ── */}
              {otherUserId ? (
                // the design's red rows at the foot
                <ul className={cn(card, "mt-5 overflow-hidden")}>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        setBlockSheetOpen(true);
                      }}
                      className={cn(row, "text-rose-600 dark:text-rose-400")}
                    >
                      <ShieldBan className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="flex-1 text-base font-semibold">Block or restrict</span>
                    </button>
                  </li>
                  <li className="border-t border-frenz-line">
                    <button
                      type="button"
                      onClick={() => {
                        haptic("light");
                        setReportOpen(true);
                      }}
                      className={cn(row, "text-rose-600 dark:text-rose-400")}
                    >
                      <Flag className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="flex-1 text-base font-semibold">Report</span>
                    </button>
                  </li>
                </ul>
              ) : null}
              <button type="button" disabled={busy} onClick={() => void deleteConversation()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 text-[14px] font-bold text-rose-700 disabled:opacity-50 dark:text-rose-400">
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete conversation
              </button>
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
          onTypingRevoked={() => announceTypingRevoked(conversationId)}
        />
      ) : null}
      {otherUserId ? <ReportSheet key="report" targetType="user" targetId={otherUserId} open={reportOpen} onClose={() => setReportOpen(false)} /> : null}
      <MessageSearchSheet key="search" open={searchOpen} onClose={() => setSearchOpen(false)} conversationId={conversationId} />
      {mediaOpen ? <ChatMediaSheet key="media" conversationId={conversationId} onClose={() => setMediaOpen(false)} /> : null}
      <ChatAppearanceSheet key="appearance" conversationId={conversationId} open={appearanceSheetOpen} onClose={() => setAppearanceSheetOpen(false)} />
      {sendCreditsOpen && otherUserId ? (
        <ChatSendCredits
          key="send"
          aboveZ={110}
          recipient={{ userId: otherUserId, name: otherName || (otherHandle ? `@${otherHandle}` : "Frenz member"), handle: otherHandle ?? null, avatarUrl: otherAvatarUrl ?? null }}
          onClose={closeSendCredits}
        />
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

type LucideIcon = typeof Palette;

/** A list row's solid icon square, white glyph (the design's rows). */
function RowIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return (
    <span aria-hidden className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white", className)}>
      <Icon className="h-[17px] w-[17px]" />
    </span>
  );
}

/**
 * "Email me new messages" (0262, owner 2026-10-18): on by default. It can be switched OFF only while the
 * member has push on a device (the installed app with notifications on) — the server says so, and the
 * row explains it rather than showing a switch that would only be refused. Read when the sheet opens,
 * one request; the switch answers on the tap and goes back if the server refuses.
 */
function MessageEmailRow() {
  const [state, setState] = useState<{ on: boolean; hasPush: boolean; ready: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch("/api/notification-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { messageEmail?: { on: boolean; hasPush: boolean; ready: boolean } } | null) => alive && setState(j?.messageEmail ?? { on: true, hasPush: false, ready: false }))
      .catch(() => alive && setState({ on: true, hasPush: false, ready: false }));
    return () => {
      alive = false;
    };
  }, []);
  const locked = !!state && state.on && !state.hasPush;
  const toggle = async () => {
    if (!state || locked) return;
    haptic("selection");
    const next = !state.on;
    setState({ ...state, on: next });
    setBusy(true);
    setError(null);
    const res = await fetch("/api/notification-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageEmail: next }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) {
      setState((s) => (s ? { ...s, on: !next } : s));
      setError(j?.error ?? "Couldn't save. Try again.");
    }
  };
  const sub = error ?? (!state ? "" : locked ? "Install the app and turn on notifications to switch this off." : state.on ? "When you're away, we email you new messages." : "Off — you get push notifications only.");
  return (
    <div className="flex min-h-[64px] items-center gap-3 px-3.5 py-2.5">
      <RowIcon icon={Mail} className="bg-frenz-magenta" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-semibold">Email me new messages</span>
        <span className={cn("text-[13px] leading-snug", error ? "text-rose-600 dark:text-rose-400" : "text-frenz-muted")} role={error ? "alert" : undefined}>
          {sub}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={state?.on ?? true}
        aria-label="Email me new messages"
        aria-disabled={!state || locked || !state.ready || undefined}
        aria-busy={busy || undefined}
        onClick={() => void toggle()}
        className="-m-[7px] flex h-11 w-16 shrink-0 items-center justify-center"
      >
        <span className={cn("flex h-[30px] w-[50px] rounded-full p-0.5 transition-colors", (state?.on ?? true) ? "justify-end bg-frenz-violet" : "justify-start bg-[#E2DFEC] dark:bg-white/20", (locked || !state?.ready) && "opacity-50")}>
          <span className="h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)]" />
        </span>
      </button>
    </div>
  );
}
