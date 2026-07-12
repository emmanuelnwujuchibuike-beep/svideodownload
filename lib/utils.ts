import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatCompactNumber(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

/** Full "posted on" date/time — for the expanded caption/post-info reveal. */
export function formatPostedOn(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Races `promise` against a timeout, resolving to `fallback` if it takes too
 * long. A slow/stuck DB query or connection has no built-in ceiling on its
 * own — left alone, an `await` on it blocks a server component's render
 * forever, which is exactly what a stuck `loading.tsx` skeleton looks like
 * from the outside (Next has nothing to fall back to since the component
 * never finishes). This turns that into a fast, recoverable failure instead.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/** Builds a safe, human-readable filename from a video title. */
export function slugifyFilename(title: string, ext: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .toLowerCase();
  return `${base || "video"}.${ext.replace(/^\./, "")}`;
}
