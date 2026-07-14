"use client";

import { motion } from "framer-motion";
import { Lock, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

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

/**
 * The inbox header's action cluster, matching the owner's mockup: two glass
 * circles at rest — compose (new group/chat) and "..." — with the remaining
 * tools (search-in-messages, presence status, notification settings) sliding
 * out of the "..." toggle instead of permanently crowding the title row.
 * Every existing launcher stays reachable; nothing was removed.
 */
export function InboxHeaderActions() {
  const [expanded, setExpanded] = useState(false);
  return (
    <span className="ml-auto flex items-center gap-1.5">
      {expanded ? (
        <motion.span
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={springs.bounce}
          className="flex items-center gap-1.5"
        >
          <MessageSearchLauncher className={CIRCLE} />
          <PresenceStatusPicker />
          <NotificationSettingsPicker />
          <Link
            href="/messages/secret"
            aria-label="Secret Chats"
            title="Secret Chats"
            onClick={() => {
              haptic("light");
              playSound("tap");
            }}
            className={`flex items-center justify-center ${CIRCLE}`}
          >
            <Lock className="h-[18px] w-[18px]" />
          </Link>
        </motion.span>
      ) : null}
      {/* Owner mockup's top-right cluster: add-friends, compose, avatar.
          "New group" moved inside the compose sheet (see ComposeLauncher)
          rather than keeping its own dedicated icon, so the header matches
          the mockup's 3-icon cluster without dropping the feature. */}
      <SuggestionsLauncher className={CIRCLE} />
      <ComposeLauncher className={CIRCLE} />
      <motion.button
        type="button"
        aria-label={expanded ? "Hide tools" : "More tools"}
        aria-expanded={expanded}
        onClick={() => {
          haptic("light");
          setExpanded((v) => !v);
        }}
        whileTap={{ scale: 0.9 }}
        transition={springs.press}
        className={`flex items-center justify-center ${CIRCLE}`}
      >
        <MoreHorizontal className="h-[18px] w-[18px]" />
      </motion.button>
      <UserMenu />
    </span>
  );
}
