"use client";

import { motion } from "framer-motion";
import { Lock, MoreVertical, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { UserMenu } from "@/features/auth/user-menu";
import { ComposeLauncher } from "@/features/social/compose-launcher";
import { MessageSearchLauncher } from "@/features/social/message-search-launcher";
import { NotificationSettingsPicker } from "@/features/social/notification-settings-picker";
import { PresenceStatusPicker } from "@/features/social/presence-status-picker";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { springs } from "@/lib/motion/springs";

/* 2026-10-08 (owner: "more premium, glassy, bolder a bit, but light weight … respond
   instantly like the earn button"): the look is `.frenz-inbox-action` in globals.css,
   with no extra JS. It presses on finger-DOWN (:active / data-pending), and the icons
   use a heavier stroke. */
// below 360 px the row was 12 px wider than the screen (the avatar clipped): 36 px circles and 4 px gaps there
const CIRCLE = "frenz-inbox-action flex h-9 w-9 items-center justify-center rounded-full text-foreground min-[360px]:h-10 min-[360px]:w-10";
const ICON = "h-[19px] w-[19px]";
const STROKE = 2.3;
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
    <span className="ml-auto flex shrink-0 items-center gap-1 min-[360px]:gap-1.5">
      {/* Owner mockup's top-right cluster: add-friends, compose, "…", avatar. */}
      {/* 2026-10-08 (owner): Add friends opens the main Friends page, and it goes once, at once, like Earn */}
      <TapOnceLink
        href="/friends"
        spinner={false}
        aria-label="Add friends"
        title="Add friends"
        onClick={() => {
          haptic("light");
          playSound("tap");
        }}
        className={CIRCLE}
      >
        <UserPlus className={ICON} strokeWidth={STROKE} aria-hidden />
      </TapOnceLink>
      <ComposeLauncher className={CIRCLE} iconClassName={ICON} strokeWidth={STROKE} />
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Hide tools" : "More tools"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={CIRCLE}
      >
        <MoreVertical className={ICON} strokeWidth={STROKE} aria-hidden />
      </button>
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
