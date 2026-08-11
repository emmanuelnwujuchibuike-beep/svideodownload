"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bookmark, Check, Link as LinkIcon, MessageSquareQuote, Send, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { springs } from "@/lib/motion/springs";
import { haptic } from "@/lib/motion/haptics";
import {
  audienceSpec,
  LIVE_DESTINATIONS,
  REPOST_AUDIENCES,
  type RepostAudience,
  type RepostDestination,
} from "@/lib/social/repost/audience";
import { toggleRepost } from "@/lib/social/repost-store";
import { cn } from "@/lib/utils";

import { RepostActionButton } from "./repost-button";
import { RepostGlyph } from "./repost-glyph";

/**
 * The repost destination sheet (Feature 15 · Part 4).
 *
 * "After tapping Repost, present a beautiful glass sheet."
 *
 * ── Rows come from the rules table, not from this file ───────────────────
 * `LIVE_DESTINATIONS` is the filter. A destination that cannot reach anywhere
 * today (Story, Community) is enumerated in `audience.ts` with its concrete
 * blocker and is NOT rendered — a disabled row advertises an action that will
 * never work, which `reshare-sheet.tsx` already corrected once ("hidden, not
 * greyed"). If a blocker is removed, flipping `live` is the whole change.
 *
 * ── The audience is chosen IN PLACE, not on a second screen ──────────────
 * Reposting is a one-tap intent. Pushing "who sees this" onto a pushed screen
 * means the default is what everyone ships with, and the default is public. The
 * picker expands inline under the row, the choice is reflected on the confirm
 * button, and the sheet never navigates.
 *
 * ── One tap still works ──────────────────────────────────────────────────
 * The hero button reposts immediately at the current audience. Everything else
 * is optional. A sheet that made a recommendation take four taps would have
 * traded the brief's "Instant Repost" for its "Repost Options".
 */
export function RepostSheet({
  postId,
  post,
  currentCount,
  open,
  onClose,
  alreadyReposted,
  /** Provenance: the repost the viewer found this through, when it was one. */
  sourceRepostId = null,
  onReposted,
  onQuote,
  onSendInChat,
  onSaveForLater,
}: {
  postId: string;
  post?: { title?: string | null; thumbnailUrl?: string | null; handle?: string | null };
  currentCount: number;
  open: boolean;
  onClose: () => void;
  alreadyReposted: boolean;
  sourceRepostId?: string | null;
  onReposted?: () => void;
  onQuote: (audience: RepostAudience) => void;
  onSendInChat: () => void;
  onSaveForLater: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [audience, setAudience] = useState<RepostAudience>("public");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => setMounted(true), []);
  // Reopening starts from the default again: an audience is a per-repost
  // decision, and silently reusing the last one is how something meant for
  // close friends goes out publicly (or the reverse) without anyone choosing.
  useEffect(() => {
    if (open) {
      setAudience("public");
      setPicking(false);
    }
  }, [open]);

  const spec = audienceSpec(audience);

  const doRepost = async () => {
    setBusy(true);
    try {
      await toggleRepost(postId, true, currentCount, null, { audience, sourceRepostId });
      onReposted?.();
      onClose();
      toast(audience === "public" ? "Reposted successfully" : `Reposted · ${spec.badge}`, "success", {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => void toggleRepost(postId, false, currentCount + 1).catch(() => {}),
        },
      });
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't repost.", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeRepost = async () => {
    setBusy(true);
    try {
      await toggleRepost(postId, false, currentCount);
      onClose();
      toast("Removed repost.", "success");
    } catch (e) {
      toast(e instanceof FrenzsaveError ? e.message : "Couldn't remove the repost.", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    onClose();
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/${postId}`);
      toast("Link copied.", "success");
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  const run = (key: RepostDestination) => {
    switch (key) {
      case "instant":
        void doRepost();
        break;
      case "quote":
        onClose();
        onQuote(audience);
        break;
      case "audience":
        haptic("light");
        setPicking((p) => !p);
        break;
      case "chat":
        onClose();
        onSendInChat();
        break;
      case "save":
        onClose();
        onSaveForLater();
        break;
      case "copy":
        void copyLink();
        break;
    }
  };

  if (!mounted) return null;

  const ICONS: Record<string, typeof Send> = {
    quote: MessageSquareQuote,
    audience: Users,
    chat: Send,
    save: Bookmark,
    copy: LinkIcon,
  };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { y: 28, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 28, opacity: 0 }}
            transition={springs.sheet}
            role="dialog"
            aria-modal="true"
            aria-label="Repost"
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />

            <div className="flex items-start gap-3 px-5 pb-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(120deg,#2563eb,#7c3aed)] text-white">
                <RepostGlyph className="h-5 w-5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <h3 className="text-sm font-bold leading-tight">Recommend this</h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {post?.handle ? `Originally by @${post.handle}` : "The creator always keeps the credit."}
                </p>
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {alreadyReposted ? (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={removeRepost}
                  disabled={busy}
                  className="w-full rounded-2xl bg-red-500/10 px-4 py-3 text-[15px] font-semibold text-red-500 transition hover:bg-red-500/15 disabled:opacity-50"
                >
                  Remove your repost
                </button>
              </div>
            ) : (
              <div className="px-4 pb-3">
                <RepostActionButton
                  onClick={() => run("instant")}
                  busy={busy}
                  label="Repost now"
                  sublabel={spec.blurb}
                />
              </div>
            )}

            <div className="px-2.5 pb-2">
              {LIVE_DESTINATIONS.filter((d) => d.key !== "instant").map((d) => {
                const Icon = ICONS[d.key] ?? LinkIcon;
                const isAudienceRow = d.key === "audience";
                return (
                  <div key={d.key}>
                    <button
                      type="button"
                      onClick={() => run(d.key)}
                      aria-expanded={isAudienceRow ? picking : undefined}
                      className="flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left transition hover:bg-secondary/70 active:scale-[0.99]"
                    >
                      <Icon className="h-5 w-5 shrink-0 text-foreground" strokeWidth={1.9} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium leading-tight">{d.label}</span>
                        {d.blurb ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">{d.blurb}</span>
                        ) : null}
                      </span>
                      {isAudienceRow ? (
                        <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                          {spec.badge}
                        </span>
                      ) : null}
                    </button>

                    {isAudienceRow ? (
                      <AnimatePresence initial={false}>
                        {picking ? (
                          <motion.div
                            initial={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                            animate={reduceMotion ? undefined : { height: "auto", opacity: 1 }}
                            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                          >
                            <div role="radiogroup" aria-label="Who can see this repost" className="space-y-0.5 py-1 pl-11 pr-2">
                              {REPOST_AUDIENCES.map((a) => (
                                <button
                                  key={a.key}
                                  type="button"
                                  role="radio"
                                  aria-checked={audience === a.key}
                                  onClick={() => {
                                    haptic("light");
                                    setAudience(a.key);
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                                    audience === a.key ? "bg-blue-500/10" : "hover:bg-secondary/60",
                                  )}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold leading-tight">{a.label}</span>
                                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{a.blurb}</span>
                                  </span>
                                  {audience === a.key ? (
                                    <Check className="h-4 w-4 shrink-0 text-blue-500" strokeWidth={2.6} />
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    ) : null}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={onClose}
                className="mt-1.5 w-full rounded-2xl bg-secondary/40 px-4 py-3 text-[15px] font-semibold transition hover:bg-secondary/70"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
