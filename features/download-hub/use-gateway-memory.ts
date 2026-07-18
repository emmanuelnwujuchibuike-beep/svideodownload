"use client";

import { useCallback, useEffect, useState } from "react";

import { EMPTY_MEMORY, type GatewayMemory } from "@/lib/download-hub/types";

/**
 * Persistence for the Discovery Gateway™. See `docs/DOWNLOAD_HUB_RFC.md` §3.3.
 *
 * Deliberately `localStorage` rather than the database, for everyone — signed in
 * or not. Dismissing a recommendation is a UI preference, it needs to survive a
 * reload and nothing more, and routing it through the server would put a request
 * on the path of a panel that must never delay the download it follows.
 */

const MEMORY_KEY = "frenz:gateway:memory";
const COUNT_KEY = "frenz:gateway:downloads";

/** Cap the stored lists so a long-lived browser can't grow this without bound. */
const MAX_REMEMBERED = 40;

function readMemory(): GatewayMemory {
  if (typeof window === "undefined") return EMPTY_MEMORY;
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    if (!raw) return EMPTY_MEMORY;
    const parsed = JSON.parse(raw) as Partial<GatewayMemory>;
    // Never trust the shape: this is user-writable storage, and a malformed
    // value here would otherwise crash the panel on every render.
    return {
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed.filter(isId) : [],
      taken: Array.isArray(parsed.taken) ? parsed.taken.filter(isId) : [],
    };
  } catch {
    return EMPTY_MEMORY;
  }
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 64;

function readCount(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(window.localStorage.getItem(COUNT_KEY));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function useGatewayMemory() {
  // Starts empty on both server and client so the first paint matches — reading
  // localStorage during render would be a hydration mismatch.
  const [memory, setMemory] = useState<GatewayMemory>(EMPTY_MEMORY);
  const [downloadCount, setDownloadCount] = useState(0);

  useEffect(() => {
    setMemory(readMemory());
    setDownloadCount(readCount());
  }, []);

  const persist = useCallback((next: GatewayMemory) => {
    setMemory(next);
    try {
      window.localStorage.setItem(MEMORY_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked (private mode, embedded webview). The panel
      // still works for this session; only durability is lost.
    }
  }, []);

  const remember = useCallback(
    (list: keyof GatewayMemory, id: string) => {
      const current = readMemory();
      if (current[list].includes(id)) return;
      persist({ ...current, [list]: [...current[list], id].slice(-MAX_REMEMBERED) });
    },
    [persist],
  );

  const dismiss = useCallback((id: string) => remember("dismissed", id), [remember]);
  const markTaken = useCallback((id: string) => remember("taken", id), [remember]);

  const countDownload = useCallback(() => {
    const next = readCount() + 1;
    setDownloadCount(next);
    try {
      window.localStorage.setItem(COUNT_KEY, String(next));
    } catch {
      /* non-fatal — see above */
    }
  }, []);

  return { memory, downloadCount, dismiss, markTaken, countDownload };
}
