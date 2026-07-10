"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BellOff, Loader2, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { categoryLabel, type Category } from "@/lib/social/categories";
import type { HomePreferences } from "@/lib/social/home-preferences";
import { DEFAULT_HOME_PREFERENCES } from "@/lib/social/home-preferences";
import { springs } from "@/lib/motion/springs";
import type { SmartReason } from "@/lib/social/smart-feed";
import { cn } from "@/lib/utils";

/**
 * "Why am I seeing this?" — Discovery Transparency made actionable (Feature
 * 17 Part 13), not just descriptive. Opened from the feed card's Smart
 * Explanation chip AND its overflow menu. Real, persisted preferences
 * (`user_home_preferences`, migration 0040) — not a cosmetic sheet — feed
 * straight back into `rankForYou`'s next query.
 */
export function ContentPreferencesSheet({
  category,
  reason,
  publisherHandle,
  open,
  onClose,
  onMuteCreator,
}: {
  category: Category | null;
  reason: SmartReason | null | undefined;
  publisherHandle: string;
  open: boolean;
  onClose: () => void;
  onMuteCreator: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<HomePreferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setPrefs(null);
    // Guards against a rapid close→reopen firing overlapping requests where
    // an earlier one resolves AFTER a later one and clobbers it with stale data.
    let cancelled = false;
    fetch("/api/home-preferences")
      .then((r) => (r.ok ? r.json() : { preferences: DEFAULT_HOME_PREFERENCES }))
      .then((d) => {
        if (!cancelled) setPrefs((d.preferences as HomePreferences) ?? DEFAULT_HOME_PREFERENCES);
      })
      .catch(() => {
        if (!cancelled) setPrefs(DEFAULT_HOME_PREFERENCES);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const isBoosted = !!(category && prefs?.boostedCategories.includes(category));
  const isMuted = !!(category && prefs?.mutedCategories.includes(category));

  const save = async (next: Partial<Pick<HomePreferences, "mutedCategories" | "boostedCategories">>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/home-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPrefs(data.preferences as HomePreferences);
    } catch {
      toast("Couldn't save that preference.", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleBoost = async () => {
    if (!category || !prefs) return;
    const boostedCategories = isBoosted
      ? prefs.boostedCategories.filter((c) => c !== category)
      : [...prefs.boostedCategories.filter((c) => c !== category), category];
    const mutedCategories = prefs.mutedCategories.filter((c) => c !== category);
    await save({ boostedCategories, mutedCategories });
    toast(isBoosted ? `Back to normal for ${categoryLabel(category)}.` : `You'll see more ${categoryLabel(category)} content.`, "success");
  };

  const toggleReduce = async () => {
    if (!category || !prefs) return;
    const mutedCategories = isMuted
      ? prefs.mutedCategories.filter((c) => c !== category)
      : [...prefs.mutedCategories.filter((c) => c !== category), category];
    const boostedCategories = prefs.boostedCategories.filter((c) => c !== category);
    await save({ mutedCategories, boostedCategories });
    toast(isMuted ? `Back to normal for ${categoryLabel(category)}.` : `You won't see ${categoryLabel(category)} content in For You.`, "success");
    if (!isMuted) onClose();
  };

  const explanation =
    reason?.label ??
    (category ? `Because you engage with ${categoryLabel(category)} content.` : "Based on your recent activity.");

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Why am I seeing this?">
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
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl"
          >
            <div className="mx-auto mb-2 mt-2.5 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-5 pb-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <Sparkles className="h-4 w-4 text-violet-500" /> Why am I seeing this?
              </h3>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="px-5 pb-3 text-sm text-muted-foreground">{explanation}</p>

            <div className="px-2.5 pb-2">
              {prefs === null ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <>
                  {category ? (
                    <>
                      <OptionRow
                        icon={ThumbsUp}
                        active={isBoosted}
                        label={isBoosted ? `Showing more ${categoryLabel(category)}` : `Show more ${categoryLabel(category)}`}
                        disabled={saving}
                        onClick={toggleBoost}
                      />
                      <OptionRow
                        icon={ThumbsDown}
                        active={isMuted}
                        label={isMuted ? `Hiding ${categoryLabel(category)} content` : `Show less ${categoryLabel(category)}`}
                        disabled={saving}
                        onClick={toggleReduce}
                      />
                    </>
                  ) : null}
                  <OptionRow icon={BellOff} label={`Mute @${publisherHandle}`} danger onClick={() => { onClose(); onMuteCreator(); }} />
                </>
              )}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function OptionRow({
  icon: Icon,
  label,
  active,
  danger,
  disabled,
  onClick,
}: {
  icon: typeof Sparkles;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left transition active:scale-[0.99] disabled:opacity-60",
        danger ? "text-red-500 hover:bg-red-500/10" : active ? "text-primary hover:bg-primary/10" : "text-foreground hover:bg-secondary/70",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} />
      <span className="block flex-1 text-[15px] font-medium leading-tight">{label}</span>
    </button>
  );
}
