import type { IdentityMode } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

import { IdentityVideo } from "./identity-video";

/**
 * Digital Identity media (Avatar Studio / Profile Video). Renders the identity a
 * profile chooses to show — photo, a silent looping profile video, or a chosen
 * avatar image — inside the avatar slot. Server-rendered:
 *  - Video uses a native muted autoplay loop (no JS); under prefers-reduced-motion
 *    it hides the video and shows the photo instead (pure CSS).
 *  - Any missing media falls back to the photo, then to the initial — so it can
 *    never render blank.
 * `className` carries the size + ring (e.g. "h-24 w-24 ring-4 ring-background").
 */
export function IdentityMedia({
  mode,
  photo,
  video,
  avatar,
  name,
  className,
}: {
  mode: IdentityMode;
  photo: string | null;
  video: string | null;
  avatar: string | null;
  name: string;
  className?: string;
}) {
  if (mode === "video" && video) {
    // Cached, instant-on-repeat, poster-first (client island) — see IdentityVideo.
    return <IdentityVideo src={video} poster={photo} className={className} />;
  }

  const src = mode === "avatar" && avatar ? avatar : photo;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="eager" className={cn("rounded-full object-cover", className)} />;
  }

  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-3xl font-bold text-white",
        className,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
