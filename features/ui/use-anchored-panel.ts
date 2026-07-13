"use client";

import { useEffect, useRef, useState } from "react";

export interface AnchoredPanelPos {
  top: number;
  right: number;
}

/**
 * Shared positioning for a trigger-anchored dropdown/menu that must portal to
 * `document.body` instead of rendering as an `absolute` sibling of its
 * trigger. Several of these panels live inside an `overflow-hidden` +
 * `backdrop-blur-xl` ancestor (backdrop-filter creates a new containing
 * block for `fixed` descendants; `overflow` clips an `absolute` one) — an
 * un-portaled panel there renders clipped or behind other content instead of
 * cleanly in front of it. This computes real viewport coordinates from the
 * trigger's own rect instead of relying on CSS containment.
 *
 * Callers render their own backdrop + panel (shapes differ too much to
 * templatize) — use the app's established `z-40` backdrop / `z-50` panel
 * pair, matching conversation-room.tsx's message-action menu. Deliberately
 * BELOW the Toaster (`z-[100]`, features/ui/toast.tsx) so a toast is never
 * hidden behind an open menu.
 */
export function useAnchoredPanel<T extends HTMLElement>(panelWidth: number, margin = 8) {
  const triggerRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<AnchoredPanelPos | null>(null);

  useEffect(() => setMounted(true), []);

  const openPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const right = Math.max(margin, Math.min(window.innerWidth - rect.right, window.innerWidth - panelWidth - margin));
      setPos({ top: rect.bottom + margin, right });
    }
    setOpen(true);
  };

  const toggle = () => (open ? setOpen(false) : openPanel());

  return { triggerRef, open, setOpen, mounted, pos, openPanel, toggle } as const;
}
