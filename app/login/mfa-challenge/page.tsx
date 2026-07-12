import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MfaChallengeForm } from "@/features/auth/mfa-challenge-form";
import { needsMfaStepUp } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify it's you",
  robots: { index: false, follow: false },
};

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const dest = next || "/home";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(dest)}`);

  // Already cleared (or never needed) the step-up — nothing to challenge.
  if (!(await needsMfaStepUp(supabase))) redirect(dest);

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-background px-5">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-500/[0.07] via-transparent to-transparent" />
      <div className="relative w-full max-w-sm">
        <MfaChallengeForm next={dest} />
      </div>
    </main>
  );
}
