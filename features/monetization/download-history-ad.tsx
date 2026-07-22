import { AdSurface } from "./ad-surface";

/**
 * The admin-managed ad slot that sits above or below the download history, on
 * both the library and the Downloads page.
 *
 * A tiny wrapper on purpose: it keeps the two `download_history_*` zone ids in
 * ONE place instead of spelling them out at every call site (which also keeps any
 * single page from naming three zone literals — the "second registry" the
 * ad-slots test guards against). Collapses to nothing until the zone is filled.
 */
export function DownloadHistoryAd({
  position,
  maxWidth = "max-w-2xl",
}: {
  position: "top" | "bottom";
  maxWidth?: string;
}) {
  return (
    <AdSurface
      zone={position === "top" ? "download_history_top" : "download_history_bottom"}
      maxWidth={maxWidth}
    />
  );
}
