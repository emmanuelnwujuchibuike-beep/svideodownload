import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminLockScreen } from "@/features/admin/lock/admin-lock-screen";
import { linkIsValid } from "@/lib/admin/lock";
import { getAdminIdentity } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New admin PIN", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The emailed PIN-reset link (owner, 2026-10-28: "when clicked on the reset pin on the email it verified securely open
 * the enter new pin page"). The link is verified here — live, unexpired, unused, and this signed-in admin's own — and
 * spent only when the new PIN is saved.
 */
export default async function AdminLockNewPinPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const admin = await getAdminIdentity();
  if (!admin) redirect("/admin/login");
  const { t } = await searchParams;
  if (!t || !(await linkIsValid(admin.id, "pin_reset", t))) return <AdminLockScreen mode={{ kind: "link_invalid", purpose: "pin_reset" }} />;
  return <AdminLockScreen mode={{ kind: "new_pin", token: t }} />;
}
