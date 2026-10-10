import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ContactsFinder } from "@/features/friends/contacts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your contacts",
  robots: { index: false, follow: false },
};

/** /friends/contacts — Contact Discovery (Feature 19 · Part 5). Contacts are read and hashed on the device. */
export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/contacts");
  // the inviter's name, for the invite message only
  const { data } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <ContactsFinder viewerName={(data?.display_name as string | null | undefined) ?? null} />
    </div>
  );
}
