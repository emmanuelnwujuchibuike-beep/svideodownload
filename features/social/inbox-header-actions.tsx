"use client";

import { motion } from "framer-motion";
import { Lock, MoreVertical } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { UserMenu } from "@/features/auth/user-menu";
import { SuggestionsLauncher } from "@/features/friends/suggestions-launcher";
import { ComposeLauncher } from "@/features/social/compose-launcher";
import { MessageSearchLauncher } from "@/features/social/message-search-launcher";
import { NotificationSettingsPicker } from "@/features/social/notification-settings-picker";
import { PresenceStatusPicker } from "@/features/social/presence-status-picker";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { springs } from "@/lib/motion/springs";

const CIRCLE = "glass h-10 w-10 rounded-full text-foreground/80 hover:text-foreground";
const MENU_WIDTH = 248;

/**
 * The inbox header's action cluster, matching the owner's mockup: two glass
 * circles at rest — compose (new group/chat) and "…" — with the remaining
 * tools (search-in-messages, presence status, notification settings, Secret
 * Chats) tucked behind the "…" toggle instead of permanently crowding the
 * title row.
 *
 * This used to reveal those tools INLINE, sliding in on the x-axis
 * (`initial={{x:12}} animate={{x:0}}`) right next to the toggle — in a
 * narrow header that's already carrying compose/…/avatar, adding 4 more
 * 40px circles in the same row pushed the row wider than the viewport,
 * overflowing horizontally (owner, 2026-07-14, reported TWICE: "opens to x
 * axis breaking the overflow x hidden"). Portal-rendered vertical dropdown
 * instead — same trigger-anchored pattern as UserMenu/PresenceStatusPicker's
 * own panel — so it opens downward (y axis) and can never widen the header.
 */
export function InboxHeaderActions() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    haptic("light");
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const margin = 8;
      const right = Math.max(margin, Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - margin));
      setPos({ top: rect.bottom + margin, right });
    }
    setOpen(true);
  };

  return (
    <span className="ml-auto flex items-center gap-1.5">
      {/* Owner mockup's top-right cluster: add-friends, compose, "…", avatar. */}
      <SuggestionsLauncher className={CIRCLE} />
      <ComposeLauncher className={CIRCLE} />
      <motion.button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Hide tools" : "More tools"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        whileTap={{ scale: 0.9 }}
        transition={springs.press}
        className={`flex items-center justify-center ${CIRCLE}`}
      >
        <MoreVertical className="h-[18px] w-[18px]" />
      </motion.button>
      <UserMenu />

      {open && pos
        ? createPortal(
            <>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={springs.sheet}
                style={{ top: pos.top, right: pos.right, width: MENU_WIDTH }}
                // `bg-card` (not `glass-strong`), matching UserMenu's own
                // dropdown right next to it — solid and theme-reactive, so
                // it always matches the (now theme-reactive, not forced-
                // light) header behind it in both light and dark mode.
                className="fixed z-50 overflow-hidden rounded-2xl border border-border/70 bg-card p-1.5 shadow-elevated"
              >
                <MessageSearchLauncher onNavigate={() => setOpen(false)} />
                {/* onCloseAll: when either picker's OWN nested popover is open
                    on top of this dropdown, its backdrop is the topmost
                    `fixed inset-0` layer and consumes the click first —
                    without this, tapping the background only closed that
                    inner popover, leaving this outer dropdown open and
                    needing a second tap (owner ask: "make the menus...
                    close when the background is clicked"). */}
                <PresenceStatusPicker onCloseAll={() => setOpen(false)} />
                <NotificationSettingsPicker onCloseAll={() => setOpen(false)} />
                <Link
                  href="/messages/secret"
                  role="menuitem"
                  onClick={() => {
                    haptic("light");
                    playSound("tap");
                    setOpen(false);
                  }}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition hover:bg-secondary"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/80 text-muted-foreground">
                    <Lock className="h-4 w-4" />
                  </span>
                  Secret Chats
                </Link>
              </motion.div>
            </>,
            document.body,
          )
        : null}
    </span>
  );
}
