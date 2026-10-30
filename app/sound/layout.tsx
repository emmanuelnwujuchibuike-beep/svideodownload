import type { Metadata } from "next";
import type { ReactNode } from "react";

// This section's stylesheet (2026-10-27): the root layout no longer imports one — see app/layout.tsx. A pass-through
// layout, nothing else; lib/perf/css-entry.test.ts fails if a page outside (marketing) is left without globals.css.
import "../app.css";

/** App-only (lib/auth/app-only-paths.ts): never indexed. Pages without their own `robots` inherit this. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
