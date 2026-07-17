import type { ReactNode } from "react";

import { PageTransition } from "@/features/app-shell/page-transition";

/**
 * (app) template — runs for every signed-in page and, unlike the layout, gets a
 * fresh instance on each navigation. That re-mount is what drives the per-page
 * transition animation (see PageTransition). The shell (sidebar, topbar, mobile
 * nav) lives in the LAYOUT above this, so it is preserved across navigation and
 * never re-mounts — only the page content transitions.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
