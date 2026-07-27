import { cn } from "@/lib/utils";

/**
 * The trademark / non-affiliation disclaimer shown below every download box, on
 * every page that has one (owner-supplied copy, verbatim). Placed inside the
 * `Downloader` by default; the landing renders it below the purple card instead
 * (where the muted colour reads), so `Downloader` is told to skip its own there.
 */
export function DownloadDisclaimer({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "mx-auto mt-6 max-w-2xl px-4 text-center text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      Frenzsave is an independent service and is not affiliated with, endorsed by, or
      sponsored by TikTok, Instagram, YouTube, Snapchat, Facebook, X, or Google. All
      trademarks and logos are the property of their respective owners.
    </p>
  );
}
