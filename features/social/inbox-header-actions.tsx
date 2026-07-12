"use client";

import { motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { CreateGroupLauncher } from "@/features/social/create-group-launcher";
import { MessageSearchLauncher } from "@/features/social/message-search-launcher";
import { NotificationSettingsPicker } from "@/features/social/notification-settings-picker";
import { PresenceStatusPicker } from "@/features/social/presence-status-picker";
import { haptic } from "@/lib/motion/haptics";
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
        </motion.span>
      ) : null}
      <CreateGroupLauncher className={CIRCLE} />
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
    </span>
  );
}
