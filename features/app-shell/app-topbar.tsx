"use client";

import { Bell, MessageSquare, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/features/auth/user-menu";

export function AppTopbar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
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
      {/* Mobile brand */}
      <Link href="/home" className="flex items-center gap-2 font-bold lg:hidden">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-violet-600 to-purple-600 text-white">
          <Plus className="h-4 w-4 rotate-45" />
        </span>
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
          href="/home#download"
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
        >
          <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Create</span>
        </Link>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            aria-label="Notifications"
            aria-expanded={bellOpen}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-background" />
          </button>
          {bellOpen ? (
            <>
              <button type="button" aria-label="Close" onClick={() => setBellOpen(false)} className="fixed inset-0 z-40 cursor-default" />
              <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevated">
                <div className="border-b border-border/60 px-4 py-3 text-sm font-semibold">Notifications</div>
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up 🎉</div>
              </div>
            </>
          ) : null}
        </div>

        {/* Messages */}
        <Link
          href="/messages"
          aria-label="Messages"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <MessageSquare className="h-5 w-5" />
        </Link>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
