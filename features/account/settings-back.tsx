"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * "‹ Menu" (design/Settings.dc.html, 2026-10-18). Settings is opened from the profile menu, which is a
 * sheet over the page the member was on — so going back returns to that page, where the menu was. A
 * Settings page opened directly (a link, a fresh tab) has nothing to go back to and goes to the
 * member's profile instead, where the menu lives.
 */
export function SettingsBack({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      className="-ml-2 flex min-h-11 items-center gap-0.5 px-2 text-base font-semibold text-frenz-violet"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden />
      Menu
    </button>
  );
}
