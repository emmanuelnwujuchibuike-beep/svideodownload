import Link from "next/link";
import { Download } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-cyan-400 text-white">
            <Download className="h-4 w-4" />
          </span>
          <span className="text-lg">
            S<span className="text-gradient">Video</span>Download
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
          <Link href="#platforms" className="transition hover:text-foreground">
            Platforms
          </Link>
          <Link href="#features" className="transition hover:text-foreground">
            Features
          </Link>
          <Link href="#faq" className="transition hover:text-foreground">
            FAQ
          </Link>
        </nav>

        <Link
          href="#"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Get Started
        </Link>
      </div>
    </header>
  );
}
