"use client";

import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The admin dashboard's Log out control.
 *
 * ── Why it does not call `supabase.auth.signOut()` directly ───────────────
 *
 * The browser client's `signOut()` defaults to `scope: "local"`: it clears this
 * device's cookie and leaves every other refresh token for the account alive.
 * For an administrator that is the wrong meaning of "log out" — the session on
 * the machine they just walked away from would still work.
 *
 * `/api/admin/auth/logout` signs out with `scope: "global"`, revoking every
 * refresh token server-side. That is what makes "opening /admin again must
 * require authentication" true of more than just this browser.
 *
 * ── `router.refresh()` before leaving ─────────────────────────────────────
 *
 * Next caches the RSC payload of the dashboard the operator is standing on. A
 * plain `push` to the login page can leave that cached, signed-in tree ready to
 * be shown again by a Back gesture. `refresh()` invalidates it, so Back lands on
 * a page that re-runs its own server-side guard and redirects.
 *
 * ── It never fails visibly ────────────────────────────────────────────────
 *
 * If the network call throws, this still navigates to the login page. An error
 * toast on a logout button invites the operator to believe they are still signed
 * in and walk away; and the next request re-validates the session server-side
 * regardless, so there is no state in which the redirect is misleading.
 */
export function AdminLogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      /* navigate anyway — see the note above */
    }
    router.refresh();
    router.replace("/admin/login");
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      aria-label="Log out of the admin dashboard"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-60 dark:hover:text-rose-400",
        className,
      )}
    >
      {busy ? (
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <LogOut aria-hidden className="h-3.5 w-3.5" />
      )}
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
