import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { PasswordEditor } from "@/features/account/password-editor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Password", robots: { index: false, follow: false } };

export default async function PasswordSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <SettingsPage title="Password" description="A second way in — and what “Forgot password?” resets.">
      <PasswordEditor />
    </SettingsPage>
  );
}
