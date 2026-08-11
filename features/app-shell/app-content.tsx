import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The center column + right rail for an app page. The surrounding shell
 * (sidebar, topbar, mobile nav, modals) lives in the persistent `(app)` layout,
 * so this is the only part that swaps on navigation. Matches the old AppShell
 * content region exactly.
 */
export function AppContent({
  rightRail,
  children,
  canvas = false,
}: {
  rightRail?: ReactNode;
  children: ReactNode;
  /**
   * 🔴 Opt this page onto the native-app canvas — the tinted ground the landing
   * page uses, with white cards floating on it (owner, 2026-08-11: "i want the
   * download page to be a blend of the landing page and the download page …
   * pure flutter native app style").
   *
   * All this does is add a marker class. The actual colour — for the page body
   * AND for the shell's topbar, which lives in a layout this component cannot
   * reach — comes from the `body:has(.frenz-canvas-page)` rules in globals.css.
   * That indirection is deliberate: it means a page can retint chrome it does
   * not own, on the first paint, with no prop drilling through the layout and no
   * client JavaScript. See the note in that file.
   */
  canvas?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4",
        canvas && "frenz-canvas-page",
      )}
    >
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">{children}</main>
      {rightRail}
    </div>
  );
}
