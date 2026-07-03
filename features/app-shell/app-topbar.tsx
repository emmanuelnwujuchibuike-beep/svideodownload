"use client";

import { Download, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { FrenzWordmark } from "@/components/brand/frenz-logo";
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
    if (term) router.push(`/explore?q=${encodeURIComponent(term)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-xl">
      {/* Mobile/tablet brand wordmark (Instagram-style) */}
      <Link href="/home" className="flex items-center lg:hidden">
        <FrenzWordmark size={30} textClassName="text-xl" />
      </Link>

      {/* Search */}
      <form onSubmit={submit} className="relative hidden max-w-xl flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search videos, people, hashtags…"
          aria-label="Search"
          className="h-10 w-full rounded-xl bg-secondary/60 pl-10 pr-12 text-sm outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-primary"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:block">
          ⌘K
        </kbd>
      </form>

      <div className="flex-1 sm:hidden" />

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Link
          href="/downloads"
          className="group inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:shadow-lg hover:shadow-violet-500/40"
        >
          <Download className="h-4 w-4 transition-transform group-hover:translate-y-0.5" /> <span className="hidden sm:inline">Download</span>
        </Link>
        {/* Create — opens the premium composer */}
        <button
          type="button"
          onClick={() => openUpload("post")}
          aria-label="Create a post"
          title="Create"
          className="hidden h-10 w-10 items-center justify-center rounded-xl bg-secondary/60 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary sm:inline-flex"
        >
          <Upload className="h-[18px] w-[18px]" />
        </button>

        {/* Notifications (realtime) */}
        <NotificationBell />

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
