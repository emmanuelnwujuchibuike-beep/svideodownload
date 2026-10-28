import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminLockScreen } from "@/features/admin/lock/admin-lock-screen";
import { linkIsValid } from "@/lib/admin/lock";
import { getAdminIdentity } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up the admin lock", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The emailed setup link: checked here (no use spent), spent by the save. */
export default async function AdminLockSetupPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const admin = await getAdminIdentity();
  if (!admin) redirect("/admin/login");
  const { t } = await searchParams;
  if (!t || !(await linkIsValid(admin.id, "setup", t))) return <AdminLockScreen mode={{ kind: "link_invalid", purpose: "setup" }} />;
  return <AdminLockScreen mode={{ kind: "setup", token: t }} />;
}
