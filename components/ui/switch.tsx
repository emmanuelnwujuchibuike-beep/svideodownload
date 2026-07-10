"use client";

import { motion, useReducedMotion } from "framer-motion";

import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

/**
 * Premium iOS-style toggle — a spring-animated thumb (not a CSS transition),
 * brand gradient + soft glow when on. Shared by every Home-module visibility
 * switch and the account Home Modules Editor's feed-behavior rows.
 */
export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200",
        checked
          ? "bg-gradient-to-r from-blue-500 to-violet-600 shadow-[0_0_10px_-1px] shadow-violet-500/60"
          : "bg-secondary ring-1 ring-inset ring-border",
        className,
      )}
    >
      <motion.span
        animate={{ x: checked ? 22 : 2 }}
        transition={reduceMotion ? { duration: 0 } : springs.bounce}
        className="inline-block h-4 w-4 rounded-full bg-white shadow"
      />
    </button>
  );
}
