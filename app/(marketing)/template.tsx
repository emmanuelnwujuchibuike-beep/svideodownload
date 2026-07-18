import type { ReactNode } from "react";

import { PageTransition } from "@/features/app-shell/page-transition";

/**
 * (marketing) template — the same premium slide transition as the (app) group,
 * now applied to the public/landing pages (/, /about, /pricing, /blog, the
 * downloader pages, …). A template gets a fresh instance per navigation, so the
 * slide plays on each client navigation between marketing pages.
 *
 * These pages flow normally in the document (they aren't in the app's flex shell),
 * so the wrapper is a plain block — not the flex-fill the (app) pages use.
 *
 * The initial page load doesn't animate (PageTransition's first-mount guard) — the
 * boot splash owns that frame, which matters most here since `/` is the cold entry.
 */
export default function MarketingTemplate({ children }: { children: ReactNode }) {
  return <PageTransition wrapperClassName="">{children}</PageTransition>;
}
