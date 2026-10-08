import { SiInstagram, SiTiktok, SiX } from "react-icons/si";

import { cn } from "@/lib/utils";

/**
 * Frenzsave's official accounts (owner, 2026-10-08: "Put follow us at tiktok,
 * Instagram and Twitter … add it to the login page bottom, and support page").
 * ONE list, so a handle and its URL can never disagree; every link opens the
 * real profile in a new tab.
 */
export const FRENZ_HANDLE = "frenzsave";

export const FRENZ_SOCIALS = [
  { id: "tiktok", name: "TikTok", url: `https://www.tiktok.com/@${FRENZ_HANDLE}`, Icon: SiTiktok },
  { id: "instagram", name: "Instagram", url: `https://www.instagram.com/${FRENZ_HANDLE}`, Icon: SiInstagram },
  { id: "x", name: "X (Twitter)", url: `https://x.com/${FRENZ_HANDLE}`, Icon: SiX },
] as const;

/** `compact`: a quiet row of round icons (login page). `buttons`: labelled pills with the handle (support page). */
export function FollowLinks({ variant = "buttons", className }: { variant?: "compact" | "buttons"; className?: string }) {
  if (variant === "compact") {
    return (
      <div className={cn("flex items-center justify-center gap-2", className)}>
        <span className="mr-1 text-[12px] font-medium text-muted-foreground">Follow us</span>
        {FRENZ_SOCIALS.map(({ id, name, url, Icon }) => (
          <a
            key={id}
            href={url}
            target="_blank"
            rel="nofollow noopener noreferrer"
            aria-label={`Frenzsave on ${name} (@${FRENZ_HANDLE})`}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card text-foreground transition hover:bg-secondary active:scale-95"
          >
            <Icon className="h-4 w-4" aria-hidden />
          </a>
        ))}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {FRENZ_SOCIALS.map(({ id, name, url, Icon }) => (
        <a
          key={id}
          href={url}
          target="_blank"
          rel="nofollow noopener noreferrer"
          aria-label={`Frenzsave on ${name}`}
          className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 active:scale-[0.98]"
        >
          <Icon className="h-4 w-4" aria-hidden />
          @{FRENZ_HANDLE}
        </a>
      ))}
    </div>
  );
}
