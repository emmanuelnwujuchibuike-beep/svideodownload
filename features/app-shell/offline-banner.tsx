"use client";

import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useNetworkStatus } from "@/lib/pwa/use-network-status";

/**
 * Replaces confusing browser network-error pages with a clear, branded
 * connectivity signal: a slim top bar while offline, then a brief "Back
 * online" confirmation on reconnect. Global (mounted in the root layout) —
 * connectivity loss isn't specific to the signed-in app shell.
 */
export function OfflineBanner() {
  const { online } = useNetworkStatus();
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      return;
    }
    if (!wasOffline) return;
    setWasOffline(false);
    setShowReconnected(true);
    const t = setTimeout(() => setShowReconnected(false), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return (
    <AnimatePresence>
      {!online ? (
        <motion.div
          key="offline"
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          role="status"
          className="fixed inset-x-0 top-0 z-[150] flex items-center justify-center gap-2 bg-foreground px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-xs font-semibold text-background"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden /> You&apos;re offline — some things may be out of date
        </motion.div>
      ) : showReconnected ? (
        <motion.div
          key="reconnected"
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          role="status"
          className="fixed inset-x-0 top-0 z-[150] flex items-center justify-center gap-2 bg-emerald-500 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-xs font-semibold text-white"
        >
          Back online
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
