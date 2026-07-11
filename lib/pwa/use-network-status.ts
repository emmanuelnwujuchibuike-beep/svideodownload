"use client";

import { useEffect, useState } from "react";

export interface NetworkStatus {
  online: boolean;
  /** Network Information API — Chrome/Edge/Android only; undefined on Safari/Firefox. */
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
}

interface NetworkInformation extends EventTarget {
  effectiveType?: NetworkStatus["effectiveType"];
  saveData?: boolean;
}

function connection(): NetworkInformation | undefined {
  return (navigator as unknown as { connection?: NetworkInformation }).connection;
}

function readStatus(): NetworkStatus {
  const conn = connection();
  return { online: navigator.onLine, effectiveType: conn?.effectiveType, saveData: conn?.saveData };
}

/**
 * Pure decision logic, split out from the `navigator.connection` read so
 * it's testable without a DOM — data saver explicitly on, or a connection
 * class slow enough that speculative prefetching would compete with what
 * the user actually asked for.
 */
export function shouldTreatAsSlowConnection(conn: { saveData?: boolean; effectiveType?: string } | undefined): boolean {
  if (!conn) return false;
  return conn.saveData === true || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
}

/**
 * Synchronous, non-hook read for imperative call sites (a prefetch-on-mount
 * timer, not a render) that want to skip non-critical bandwidth use.
 * Chrome/Edge/Android only (Network Information API); everywhere else
 * (Safari, Firefox) this always returns false — prefetching stays as before,
 * since there's no signal to act on, not because it was judged unnecessary.
 */
export function isSlowConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  return shouldTreatAsSlowConnection(connection());
}

/**
 * Online/offline plus, where available, connection quality — feeds the
 * offline banner and can inform "skip this non-critical background refresh
 * on a slow connection" call sites later. SSR-safe (assumes online until
 * mounted, matching how every other client-only PWA hook in this app behaves).
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({ online: true });

  useEffect(() => {
    setStatus(readStatus());
    const update = () => setStatus(readStatus());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    connection()?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      connection()?.removeEventListener?.("change", update);
    };
  }, []);

  return status;
}
