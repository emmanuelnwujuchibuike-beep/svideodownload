"use client";

import { useEffect } from "react";

import { attachMediaProtection } from "@/lib/dom/media-protection";

/**
 * Mounts the app-wide media protection. Renders nothing.
 *
 * Mounted once from `DeferredShell`, so every surface — marketing, app, PWA,
 * modals, fullscreen viewers — is covered by a single pair of delegated
 * listeners rather than per-component handlers on 112 image call sites and 28
 * video ones.
 *
 * 🔴 This deliberately does NOT touch navigation, history or the DOM tree —
 * the standing rule DeferredShell's own doc sets out. It adds two listeners
 * for `contextmenu` and `dragstart` and removes them on unmount. No touch
 * handlers, no MutationObserver, no `pushState` patching, nothing that could
 * interfere with App Router prefetch, scrolling or gestures.
 */
export function MediaProtection() {
  useEffect(() => attachMediaProtection(), []);
  return null;
}
