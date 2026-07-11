import Image from "next/image";

import { cn } from "@/lib/utils";

/** Small overlapping-avatar fallback for a group with no custom photo. */
export function GroupAvatarStack({
  avatars,
  size = "md",
}: {
  avatars: { avatarUrl: string | null; displayName: string }[];
  size?: "md" | "lg";
}) {
  const shown = avatars.slice(0, 3);
  const box = size === "lg" ? "h-10 w-10" : "h-12 w-12";
  const avatarSize = size === "lg" ? "h-6 w-6" : "h-7 w-7";

  if (shown.length === 0) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-sm font-bold text-white", box)}>
        #
      </span>
    );
  }

  return (
    <span className={cn("flex shrink-0 items-center justify-center", box)}>
      <span className="flex -space-x-2.5">
        {shown.map((a, i) => (
          <span key={i} className={cn("overflow-hidden rounded-full ring-2 ring-card", avatarSize)} style={{ zIndex: shown.length - i }}>
            {a.avatarUrl ? (
              <Image src={a.avatarUrl} alt="" width={28} height={28} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500 to-violet-600 text-[10px] font-bold text-white">
                {a.displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
