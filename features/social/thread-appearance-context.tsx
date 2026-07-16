"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { ConversationTheme } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/client";

interface ThreadAppearance {
  theme: ConversationTheme | null;
  wallpaperUrl: string | null;
}

const ThreadAppearanceContext = createContext<ThreadAppearance>({ theme: null, wallpaperUrl: null });

export function useThreadAppearance(): ThreadAppearance {
  return useContext(ThreadAppearanceContext);
}

/**
 * Wraps the whole thread view (header + message list + composer — every
 * sibling under the thread page's outer full-screen div) in ONE shared,
 * live-synced theme/wallpaper state, and renders the wallpaper image on
 * THIS outer div so it spans the full screen, top:0 to bottom:0.
 *
 * Before this, each of those three pieces tracked theme/wallpaper
 * independently: `ConversationRoom` had its own realtime-synced state (and
 * painted the wallpaper only on the message list's own box), while
 * `ThreadHeader` only ever read the static SSR `initialTheme`/
 * `initialWallpaperUrl` props with no live update at all. Two visible bugs
 * followed: a wallpaper only ever showed in the middle of the screen,
 * visibly cropped by solid header/composer bars above and below it (owner,
 * 2026-07-14: "i want it to save and full screen, top 0 bottom 0 just like
 * chat theme"); and the header never picked up a theme/wallpaper change
 * from another member's edit without a full reload. One shared provider
 * fixes both at once instead of bolting a live-update path onto each
 * component separately.
 */
export function ThreadAppearanceProvider({
  conversationId,
  initialTheme,
  initialWallpaperUrl,
  className,
  children,
}: {
  conversationId: string;
  initialTheme: ConversationTheme | null;
  initialWallpaperUrl: string | null;
  className?: string;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [wallpaperUrl, setWallpaperUrl] = useState(initialWallpaperUrl);

  useEffect(() => {
    setTheme(initialTheme);
    setWallpaperUrl(initialWallpaperUrl);
    const supabase = createClient();
    const channel = supabase
      .channel(`conversation-appearance:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as { theme?: ConversationTheme | null; wallpaper_url?: string | null };
          if (row.theme !== undefined) setTheme(row.theme);
          if (row.wallpaper_url !== undefined) setWallpaperUrl(row.wallpaper_url);
        },
      )
      .subscribe();
    return () => void supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seeds from the (possibly stale) initial props once per conversationId, not on every prop identity change
  }, [conversationId]);

  return (
    <ThreadAppearanceContext.Provider value={{ theme, wallpaperUrl }}>
      <div
        className={`frenz-thread ${className ?? ""}`}
        style={wallpaperUrl ? { backgroundImage: `url(${wallpaperUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      >
        {children}
      </div>
    </ThreadAppearanceContext.Provider>
  );
}
