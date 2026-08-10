import { cn } from "@/lib/utils";

/**
 * The trademark / non-affiliation disclaimer shown below every download box, on
 * every page that has one (owner-supplied copy, verbatim). Placed inside the
 * `Downloader` by default; the landing renders it below the purple card instead
 * (where the muted colour reads), so `Downloader` is told to skip its own there.
 */
export function DownloadDisclaimer({
  className,
  /**
   * 🔴 An explicit prop rather than a `text-left` passed through `className`.
   *
   * Tailwind emits `text-left` BEFORE `text-center`, and CSS resolves ties by
   * source order in the stylesheet, not by order in the class attribute — so a
   * `text-left` override would lose silently and look like it had been applied.
   * That class of trap has cost this codebase real time more than once. Only
   * one alignment utility is ever on the element now, so there is nothing to
   * resolve.
   */
  align = "center",
}: {
  className?: string;
  align?: "center" | "left";
}) {
  return (
    <p
      className={cn(
        "mx-auto mt-6 max-w-2xl px-4 text-[11px] leading-relaxed text-muted-foreground",
        align === "center" ? "text-center" : "text-left",
        className,
      )}
    >
      Frenzsave is an independent service and is not affiliated with, endorsed by, or
      sponsored by TikTok, Instagram, YouTube, Snapchat, Facebook, X, or Google. All
      trademarks and logos are the property of their respective owners.
    </p>
  );
}
