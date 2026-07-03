"use client";

import { IoCloudDownloadOutline, IoCloudUploadOutline, IoSearchOutline } from "react-icons/io5";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/features/app-shell/notification-bell";
import { openUpload } from "@/features/create/upload-store";
import { UserMenu } from "@/features/auth/user-menu";

export function AppTopbar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : "/search");
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/20 bg-background/60 px-4 backdrop-blur-xl">
      {/* Plain, full-bleed top bar — no logo, blends with the body (FB/TikTok/IG style) */}
      <div className="flex-1 sm:hidden" />

      {/* Search — pill, Instagram/Snapchat style */}
      <form onSubmit={submit} className="relative hidden max-w-xl flex-1 sm:block">
        <IoSearchOutline className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search videos, people, hashtags…"
          aria-label="Search"
          className="h-11 w-full rounded-full bg-secondary/50 pl-11 pr-12 text-sm outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-2 focus:ring-primary/40"
        />
        <kbd className="pointer-events-none absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:block">
          ⌘K
        </kbd>
      </form>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Mobile search entry (the search box is tablet+ only) */}
        <Link
          href="/search"
          aria-label="Search"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary active:scale-95 sm:hidden"
        >
          <IoSearchOutline className="h-[20px] w-[20px]" />
        </Link>
        <Link
          href="/downloads"
          className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/25 ring-1 ring-inset ring-white/10 transition hover:shadow-xl hover:shadow-violet-500/40"
        >
          <IoCloudDownloadOutline className="h-[18px] w-[18px] transition-transform group-hover:translate-y-0.5" />
          <span className="hidden sm:inline">Download</span>
        </Link>

        {/* Create / upload — opens the premium composer */}
        <button
          type="button"
          onClick={() => openUpload("post")}
          aria-label="Create a post"
          title="Create"
          className="hidden h-11 w-11 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary hover:text-primary hover:ring-primary/40 sm:inline-flex"
        >
          <IoCloudUploadOutline className="h-[21px] w-[21px]" />
        </button>

        {/* Notifications — mobile/tablet only (large screens use the sidebar
            Notifications item, so the top-right stays uncluttered). */}
        <span className="lg:hidden">
          <NotificationBell />
        </span>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        {/* Avatar menu — desktop/tablet; on mobile the Profile tab in the bottom nav covers this */}
        <div className="hidden sm:block">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
