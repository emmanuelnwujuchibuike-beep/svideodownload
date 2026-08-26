import type { Metadata } from "next";

import { AdminResetPasswordForm } from "@/features/admin/admin-password-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a new password",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The landing page for the emailed recovery link.
 *
 * 🔴 Must be reachable WITHOUT an admin session — the whole point is that the
 * operator cannot get in. It is safe because the recovery token in the URL
 * fragment is what authorises the change, and the API behind the form
 * re-validates the session server-side before touching anything.
 *
 * It is also why the middleware allowlists this path alongside /admin/login.
 */
export default function AdminResetPasswordPage() {
  return <AdminResetPasswordForm />;
}
