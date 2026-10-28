import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminLockScreen } from "@/features/admin/lock/admin-lock-screen";
import { adminLockStage, adminLockStatus } from "@/lib/admin/lock";
import { getAdminIdentity } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin dashboard", robots: { index: false, follow: false } };

/** Same-origin /admin paths only (the login page's open-redirect rule), and never back into the lock itself. */
function safeNext(next?: string): string {
  if (!next || !next.startsWith("/admin") || next.startsWith("//") || next.startsWith("/admin/unlock")) return "/admin";
  return next;
}

/**
 * The admin dashboard lock (0301): the dashboard password, then the PIN. Every admin page sends a locked admin here
 * (requireAdminPage), and this page sends them on to `next` once this browser is unlocked.
 */
export default async function AdminUnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const admin = await getAdminIdentity();
  if (!admin) redirect("/admin/login");
  const next = safeNext((await searchParams).next);
  const [stage, status] = await Promise.all([adminLockStage(admin.id), adminLockStatus(admin.id)]);
  if (stage === "unlocked") redirect(next);
  if (!status) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-4 text-center text-sm text-muted-foreground">
        The admin lock can&apos;t be read. Run migration 0301 and check ADMIN_LOCK_PEPPER, then reload.
      </main>
    );
  }
  if (!status.set) return <AdminLockScreen mode={{ kind: "not_set" }} />;
  return <AdminLockScreen mode={{ kind: "unlock", stage: stage === "password" ? "pin" : "password", next, lockedUntil: status.lockedUntil }} />;
}
