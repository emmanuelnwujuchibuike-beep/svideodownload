"use client";

import { motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * Premium segmented theme switcher (light / dark / system) with a sliding pill
 * indicator — styled after the iOS-style control in the Claude app.
 */
export function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const pillId = useId();
  useEffect(() => setMounted(true), []);

  const dim = size === "sm" ? "h-8 w-8" : "h-9 w-9";

  // Avoid hydration mismatch: render a neutral placeholder until mounted.
  if (!mounted) {
    return (
      <div
        aria-hidden
        className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1"
      >
        {OPTIONS.map((o) => (
          <span key={o.value} className={cn(dim, "rounded-full")} />
        ))}
      </div>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1 backdrop-blur"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "relative inline-flex items-center justify-center rounded-full transition-colors",
              dim,
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`theme-pill-${pillId}`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border"
              />
            )}
            <Icon className="relative z-10 h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
