"use client";

import { ChevronRight, Globe } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { findLanguage, LANGUAGE_COOKIE } from "@/lib/i18n/languages";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

import { LanguageMenu } from "./language-menu";

/**
 * Language picker as a full-width SETTINGS ROW — for the profile menu and the
 * settings page (owner: "put the language selector in settings and profile menu").
 * Unlike the header trigger it can import the language table + `findLanguage`
 * directly (these surfaces aren't on the landing's cold-entry budget), so it shows
 * the chosen language's real name. Opens the same lazy `LanguageMenu` panel.
 */
function readLang(): string {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)frenz_lang=([^;]+)/);
  if (m?.[1]) return m[1];
  try {
    return localStorage.getItem(LANGUAGE_COOKIE) ?? "en";
  } catch {
    return "en";
  }
}

export function LanguageSettingRow({
  className,
  icon: Icon = Globe,
}: {
  className?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  const [current, setCurrent] = useState("en");
  const [open, setOpen] = useState(false);

  useEffect(() => setCurrent(readLang()), []);
  const active = findLanguage(current);

  const openMenu = () => {
    haptic("light");
    playSound("tap");
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        className={cn(
          "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-secondary/70",
          className,
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-inset ring-border/60">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Language</span>
          <span className="block truncate text-xs text-muted-foreground">
            {active.native}
            {active.native !== active.name ? ` · ${active.name}` : ""}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
      </button>

      {open ? (
        <LanguageMenu
          current={current}
          onChoose={(code) => {
            setCurrent(code);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
