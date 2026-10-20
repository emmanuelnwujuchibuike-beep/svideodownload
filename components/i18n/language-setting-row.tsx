"use client";

import { ChevronRight, Globe } from "lucide-react";
import dynamic from "next/dynamic";
import { type ComponentType, useEffect, useState } from "react";

import { readCookie } from "@/lib/dom/cookie";
import { findLanguage, LANGUAGE_COOKIE } from "@/lib/i18n/languages";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

// lazy: the menu carries every language's strings (~25 kB gz) — loaded on the tap, never with Settings (2026-10-20)
const LanguageMenu = dynamic(() => import("./language-menu").then((m) => m.LanguageMenu), { ssr: false });

/**
 * Language picker as a full-width SETTINGS ROW — for the profile menu and the
 * settings page (owner: "put the language selector in settings and profile menu").
 * Unlike the header trigger it can import the language table + `findLanguage`
 * directly (these surfaces aren't on the landing's cold-entry budget), so it shows
 * the chosen language's real name. Opens the same lazy `LanguageMenu` panel.
 */
function readLang(): string {
  if (typeof document === "undefined") return "en";
  const fromCookie = readCookie(LANGUAGE_COOKIE); // guarded — see lib/dom/cookie.ts
  if (fromCookie) return fromCookie;
  try {
    return localStorage.getItem(LANGUAGE_COOKIE) ?? "en";
  } catch {
    return "en";
  }
}

export function LanguageSettingRow({
  className,
  icon: Icon = Globe,
  variant = "row",
}: {
  className?: string;
  icon?: ComponentType<{ className?: string }>;
  /**
   * "row" — the original settings row. The Settings redesign (design/Settings.dc.html, 2026-10-18)
   * adds "tile" (a quick-settings tile) and "list" (a row in an iOS list, the value on the right).
   * Every variant opens the same lazy LanguageMenu.
   */
  variant?: "row" | "tile" | "list";
}) {
  const [current, setCurrent] = useState("en");
  const [open, setOpen] = useState(false);

  useEffect(() => setCurrent(readLang()), []);
  const active = findLanguage(current);

  // the chunk starts loading the moment a finger lands, so the panel opens without a wait
  const preload = () => void import("./language-menu");
  const openMenu = () => {
    haptic("light");
    playSound("tap");
    setOpen(true);
  };

  const menu = open ? (
    <LanguageMenu
      current={current}
      onChoose={(code) => {
        setCurrent(code);
        setOpen(false);
      }}
      onClose={() => setOpen(false)}
    />
  ) : null;

  if (variant === "tile") {
    return (
      <>
        <button type="button" onClick={openMenu} onPointerDown={preload} className={cn("flex w-full flex-col gap-3.5 rounded-[20px] border border-frenz-line bg-frenz-card p-3.5 text-left transition active:scale-[0.98]", className)}>
          <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-frenz-blue text-white">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-bold">Language</span>
            <span className="truncate text-xs text-frenz-muted">{active.native}</span>
          </span>
        </button>
        {menu}
      </>
    );
  }

  if (variant === "list") {
    return (
      <>
        <button type="button" onClick={openMenu} onPointerDown={preload} className={cn("flex min-h-[60px] w-full items-center gap-3 px-3.5 py-2 text-left transition active:bg-frenz-fill", className)}>
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-frenz-blue text-white">
            <Icon className="h-[17px] w-[17px]" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-base font-semibold">Language</span>
            <span className="truncate text-[13px] text-frenz-muted">App and content language</span>
          </span>
          <span className="max-w-[40%] truncate text-sm text-frenz-muted">{active.native}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-frenz-muted" aria-hidden />
        </button>
        {menu}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openMenu} onPointerDown={preload}
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

      {menu}
    </>
  );
}
