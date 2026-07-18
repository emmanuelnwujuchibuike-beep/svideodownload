"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

/**
 * Mounts the Command Center without paying for it up front.
 *
 * ── Why the palette is lazy ────────────────────────────────────────────────────
 *
 * `/` is a static page under a 2-second cold-entry budget whose LCP already sits
 * near the ceiling. The palette is a dialog most visitors never open, so shipping
 * it in the initial bundle would tax every first paint to serve a minority — the
 * exact trade the budget exists to prevent. This shim is a keydown listener and a
 * boolean; the palette (and everything it pulls in — the nav registry, next-themes,
 * the Supabase client) downloads only once someone asks for it.
 *
 * ── Why a hand-rolled import() and not next/dynamic ───────────────────────────
 *
 * `dynamic(() => import(...), { ssr: false })` was tried first and NEVER RESOLVED
 * here: the listener attached, the key was received, state flipped — and the
 * component silently rendered nothing. No console error, no failed request,
 * nothing to trace. Swapping to a static import proved the palette itself was
 * fine, which isolated the loader as the fault.
 *
 * An explicit `import()` into state is a few more lines and has no magic: the
 * promise either resolves and we render, or it rejects and we log it. For a
 * keyboard-driven surface — where a silent no-op is indistinguishable from a
 * broken shortcut — that visibility is worth more than the brevity.
 */
type PaletteProps = { open: boolean; onClose: () => void };

export function CommandCenterMount() {
  const [Palette, setPalette] = useState<ComponentType<PaletteProps> | null>(null);
  const [open, setOpen] = useState(false);
  // Guards a second import while the first is in flight — holding ⌘K down fires
  // the handler repeatedly.
  const loading = useRef(false);

  const request = useCallback(async () => {
    setOpen(true);
    if (loading.current) return;
    loading.current = true;
    try {
      const mod = await import("./command-center");
      // Functional set: React would otherwise call a component passed to setState
      // as an updater rather than storing it.
      setPalette(() => mod.CommandCenter);
    } catch (err) {
      // Surfaced, not swallowed: a shortcut that does nothing is the most
      // confusing failure a palette can have.
      console.error("[command-center] failed to load", err);
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    /*
     * ⌘K on macOS, Ctrl+K elsewhere — the convention people already have muscle
     * memory for. "/" also opens it, but only when focus is not in a text field,
     * or typing a slash into the downloader would hijack the page.
     */
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !isTyping(e.target);
      if (shortcut || slash) {
        e.preventDefault();
        void request();
      }
    };

    // Any surface can open the palette without prop-drilling a setter through the
    // whole shell: window.dispatchEvent(new Event("frenz:command-center")).
    const onOpen = () => void request();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("frenz:command-center", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("frenz:command-center", onOpen);
    };
  }, [request]);

  if (!Palette) return null;
  return <Palette open={open} onClose={() => setOpen(false)} />;
}
