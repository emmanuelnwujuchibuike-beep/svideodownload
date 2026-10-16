/** "Downloading…", with the share of bytes in when the size is known — one label for both choices. */
export function downloadingLabel(fraction: number | null, item?: { done: number; total: number }): string {
  const of = item && item.total > 1 ? ` ${Math.min(item.done + 1, item.total)} of ${item.total}` : "";
  const pct = fraction != null && fraction > 0 && fraction < 1 ? ` ${Math.round(fraction * 100)}%` : "";
  return `Downloading${of}…${pct}`;
}
