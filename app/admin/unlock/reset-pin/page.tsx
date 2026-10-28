import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminLockScreen } from "@/features/admin/lock/admin-lock-screen";
import { adminLockStatus } from "@/lib/admin/lock";
import { getAdminIdentity } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reset the admin PIN", robots: { index: false, follow: false } };

/** PIN reset, step 1: the dashboard passwords (current + previous, or current twice), then an emailed link. */
export default async function AdminLockResetPinPage() {
  const admin = await getAdminIdentity();
  if (!admin) redirect("/admin/login");
  const status = await adminLockStatus(admin.id);
  if (!status?.set) redirect("/admin/unlock");
  return <AdminLockScreen mode={{ kind: "reset_request", hasPrevious: status.hasPrevious }} />;
}
