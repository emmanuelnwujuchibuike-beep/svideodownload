"use client";

import { useEffect } from "react";

import { logError } from "@/lib/observability/log-error";

/**
 * Last-resort boundary — only fires if the ROOT layout itself throws (a
 * failure in ThemeProvider/BootSplash/etc., not a route's own content). Per
 * Next's convention this must render its own complete `<html>`/`<body>` and
 * stay maximally simple: it can't rely on anything the broken root layout
 * provides (theme context, the shared ErrorFallback's usual styling
 * assumptions), so it's deliberately plain rather than on-brand.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logError("Root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050816",
          color: "#e5e7eb",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#9ca3af", fontSize: "0.9rem", margin: "0 0 1.5rem" }}>
            Frenz hit an unexpected error. Reloading usually fixes this.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "linear-gradient(to right, #2563eb, #7c3aed)",
              color: "#fff",
              border: "none",
              borderRadius: "0.75rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
