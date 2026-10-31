import type { ReactNode } from "react";

import { AiStudioShell } from "@/features/ai/design/ai-studio-shell";

/**
 * The desktop shell for every `/ai/*` screen.
 *
 * Owner's brief §6: a professional application layout on desktop, with a left
 * sidebar. Until now these routes had no desktop navigation at all — the phone
 * layout simply stretched across a 1440px window, which §4 forbids in as many
 * words ("Do NOT simply make the desktop layout shrink down").
 *
 * ── A LAYOUT, not an edit to twenty-two pages ───────────────────────────────
 *
 * Both doors (`/ai/*` and `/studio/ai/*`) render the same feature components,
 * so the shell belongs at the route-group boundary. §51: improve the product,
 * do not rewrite the project.
 *
 * ⚠️ It adds NO server work and reads no cookies. A layout that touched the
 * session here would make every page under it dynamic, and this project has
 * already shipped a prerendered redirect that way once.
 *
 * The sidebar is `lg:` only, matching the existing bottom navigation's
 * `lg:hidden` exactly, so the two can never both appear and never both vanish.
 */
export default function AiLayout({ children }: { children: ReactNode }) {
  return <AiStudioShell>{children}</AiStudioShell>;
}
