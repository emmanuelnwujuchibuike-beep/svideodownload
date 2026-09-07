"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { useUser } from "@/features/auth/use-user";
import { useHistory } from "@/features/history/use-history";
import { STORAGE_FULL_EVENT, type StorageFullDetail } from "@/lib/downloads/storage-full-event";

/**
 * Turns a refused download into the upgrade-or-clear dialog, from anywhere.
 *
 * Owner, 2026-09-07: "Make sure free users who exceed their 5gb storage limit
 * will not be able to save media, any download should show storage full free
 * storage or upgrade to pro."
 *
 * ── Why this is mounted globally rather than per download surface ────────────
 *
 * The paste box and the downloader page each had their own copy of the ceiling
 * check, and the two paths that can actually FILL 5 GB — the multi-link batch
 * panel and wallpaper saves — had neither. They call the download manager
 * directly, so both went straight past the checks.
 *
 * The manager now refuses (features/downloads/manager.ts) and announces it. That
 * makes the rule true everywhere, including on call sites nobody has written
 * yet — but a plain module cannot render a dialog, so something mounted has to
 * listen. This is that thing, and it is mounted once in the app shell so no
 * surface can be added without it.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *
 * It renders `null` until a refusal actually happens, and `QuotaGate` is
 * `dynamic`, so a visitor who is nowhere near their limit — nearly everyone —
 * downloads none of its bytes. The event constant lives in its own
 * dependency-free module for the same reason, so mounting this on every route
 * does not drag the manager, the history store and IndexedDB onto pages that
 * never download anything.
 */

const QuotaGate = dynamic(() => import("@/features/downloads/quota-gate").then((m) => m.QuotaGate), {
  ssr: false,
});

export function StorageFullGate() {
  const [detail, setDetail] = useState<StorageFullDetail | null>(null);
  const { plan } = useEntitlements();
  const { user } = useUser();
  const { clearHistory } = useHistory();

  useEffect(() => {
    const onFull = (e: Event) => {
      const d = (e as CustomEvent<StorageFullDetail>).detail;
      if (d) setDetail(d);
    };
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);

  if (!detail) return null;

  return (
    <QuotaGate
      open
      usedBytes={detail.usedBytes}
      count={detail.count}
      limitBytes={detail.limitBytes}
      plan={plan}
      signedIn={!!user}
      /*
        Clearing history is the whole point of the other button — once it has
        run, the library is under the ceiling and the next attempt succeeds, so
        the dialog closes with it rather than leaving a stale "you are full"
        message over an empty library.
      */
      onClearHistory={() => {
        clearHistory();
        setDetail(null);
      }}
      onClose={() => setDetail(null)}
    />
  );
}
