import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

/** Returns the signed-in user only if they're an admin, else null. */
export async function getAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return isAdmin(profile?.role, user.email) ? user : null;
}
