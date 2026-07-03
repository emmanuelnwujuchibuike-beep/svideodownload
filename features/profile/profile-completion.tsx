import { Sparkles } from "lucide-react";
import Link from "next/link";

/**
 * Owner-only profile completion card: a gradient meter plus the single next
 * best action. Weights: avatar 30, bio 30, banner 20, business link 20.
 */
export function ProfileCompletion({
  hasAvatar,
  hasBio,
  hasBanner,
  hasWebsite,
}: {
  hasAvatar: boolean;
  hasBio: boolean;
  hasBanner: boolean;
  hasWebsite: boolean;
}) {
  const percent =
    (hasAvatar ? 30 : 0) + (hasBio ? 30 : 0) + (hasBanner ? 20 : 0) + (hasWebsite ? 20 : 0);
  if (percent >= 100) return null;

  const next = !hasAvatar
    ? "Add a profile photo"
    : !hasBio
      ? "Write a short bio"
      : !hasBanner
        ? "Add a banner"
        : "Add your business link";

  return (
    <Link
      href="/account#profile"
      className="mt-5 block rounded-3xl border border-border/70 bg-card/70 p-4 backdrop-blur transition hover:bg-card"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-foreground" />
          Profile {percent}% complete
        </p>
        <span className="text-xs font-medium text-primary">{next} →</span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-[width] duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
    </Link>
  );
}
