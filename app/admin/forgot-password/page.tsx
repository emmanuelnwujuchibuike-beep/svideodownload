import type { Metadata } from "next";

import { AdminForgotPasswordForm } from "@/features/admin/admin-password-forms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset admin password",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Public by design — someone who cannot sign in cannot be asked to sign in
 * first. It reveals nothing: the endpoint behind it answers identically for
 * every address (see /api/admin/auth/forgot-password).
 */
export default function AdminForgotPasswordPage() {
  return <AdminForgotPasswordForm />;
}
