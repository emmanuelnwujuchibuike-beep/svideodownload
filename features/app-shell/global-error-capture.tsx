"use client";

import { useEffect } from "react";

import { logError } from "@/lib/observability/log-error";

/**
 * Catches what React's error.tsx boundaries structurally CAN'T: unhandled
 * promise rejections and runtime errors thrown outside the render tree (an
 * event handler, a setTimeout callback, a background task). error.tsx only
 * fires on a render-time throw — everything else was previously silent
 * (visible only in devtools console, never surfaced anywhere).
 */
export function GlobalErrorCapture() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      // Suppresses the browser's own default "Uncaught (in promise)" log —
      // logError() below is now the one place this gets reported.
      event.preventDefault();
      logError("Unhandled promise rejection:", event.reason);
    };
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      logError("Unhandled runtime error:", event.error ?? event.message);
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
