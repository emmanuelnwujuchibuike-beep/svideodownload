import { ChevronUp, Download } from "lucide-react";
import Link from "next/link";

/** Sticky shortcut to the hero downloader — mirrors the mockup's bottom dock.
 * Acts as a quick jump to the full paste-and-download widget at #download. */
export function DownloadDock() {
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 mt-4 hidden justify-center px-4 lg:flex">
      <Link
        href="#download"
        className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-border/60 bg-card/95 p-2 pl-4 shadow-elevated backdrop-blur-xl transition hover:border-foreground/15"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
          <Download className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm text-muted-foreground">Paste any link here (TikTok, Instagram, X, Facebook…)</span>
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white">
          <Download className="h-4 w-4" /> Download
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <ChevronUp className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}
