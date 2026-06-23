"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * A bold, centered ad shown directly above a freshly-fetched result for ~5
 * seconds, then it auto-dismisses. Closable early. Hidden for premium users and
 * when no `result_top` ad is configured (the slot renders nothing). Non-blocking.
 */
export function FetchedAd() {
  const { showAds } = useShowAds();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  if (!showAds) return null;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="relative mx-auto mt-6 w-full max-w-2xl"
        >
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sponsored
              </span>
              <button
                type="button"
                onClick={() => setVisible(false)}
                aria-label="Close"
                className="rounded-md p-0.5 text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* not individually dismissible — the whole banner has its own X + 5s timer */}
            <AdSlot zone="result_top" dismissible={false} />
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
