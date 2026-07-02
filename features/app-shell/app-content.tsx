import type { ReactNode } from "react";

/**
 * The center column + right rail for an app page. The surrounding shell
 * (sidebar, topbar, mobile nav, modals) lives in the persistent `(app)` layout,
 * so this is the only part that swaps on navigation. Matches the old AppShell
 * content region exactly.
 */
export function AppContent({ rightRail, children }: { rightRail?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-3 sm:px-4">
      <main className="min-w-0 flex-1 pb-24 pt-4 lg:pb-6">{children}</main>
      {rightRail}
    </div>
  );
}
