"use client";

import { Download, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";

const NAV_LINKS = [
  { href: "/#platforms", label: "Platforms" },
  { href: "/#features", label: "Features" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 text-white">
            <Download className="h-4 w-4" />
          </span>
          <span className="text-lg">
            S<span className="text-gradient">Video</span>Download
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="transition hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Link
            href="/#download"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Get Started
          </Link>
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-border/40 bg-background/95 backdrop-blur-xl md:hidden">
          <nav className="container flex flex-col gap-1 py-4">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-base font-medium text-foreground transition hover:bg-secondary"
              >
                {l.label}
              </Link>
            ))}

            <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-card/60 p-3">
              <span className="text-sm font-medium text-muted-foreground">Appearance</span>
              <ThemeToggle />
            </div>

            <Link
              href="/#download"
              onClick={() => setOpen(false)}
              className="mt-2 rounded-xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground"
            >
              Get Started
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
