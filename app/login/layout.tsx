import type { ReactNode } from "react";

// This section's stylesheet (2026-10-27): the root layout no longer imports one — see app/layout.tsx. A pass-through
// layout, nothing else; lib/perf/css-entry.test.ts fails if a page outside (marketing) is left without globals.css.
import "../app.css";

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
