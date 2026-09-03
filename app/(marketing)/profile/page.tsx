import type { Metadata } from "next";

import { LoginPersonalizeCard } from "@/components/landing/login-personalize-card";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export const dynamic = "force-static";

/*
  🔴 noindex (2026-08-16 SEO audit) — this is a sign-in doorway with no real
  personal content, the same shape as /library, /history and /welcome, which
  are already correctly noindexed. This one had no `robots` override at all,
  so it inherited the root layout's `index:true` by accident rather than by
  decision — a thin page Google had no reason to rank was indexable purely
  because nobody had set the same flag its siblings already carry.
*/
export const metadata: Metadata = {
  title: "Profile",
  description: "Sign in to Frenz to personalize your experience — save what you find, track history and more.",
  alternates: { canonical: "/profile" },
  robots: { index: false, follow: false },
};

/**
 * The landing "Profile" tab (bottom nav). A signed-out visitor has no profile yet,
 * so this is the sign-in doorway (owner: "that's the section that will be in the
 * profile page so it directs to the login page"). Static, no request data, so it
 * prerenders like the rest of the marketing group; the middleware sends a
 * signed-in visitor on to their real profile.
 *
 * The signed-in profile DASHBOARD is the owner's own /u/[handle] view — it must
 * never appear here (owner, 2026-07-27: "i dont want any users to login and see
 * that fake profile page in the landing page").
 */
export default function ProfilePage() {
  return (
    <div className="bg-background text-foreground">
      <SiteHeader />
      <main className="container flex min-h-[70vh] max-w-3xl flex-col justify-center pb-24 pt-[calc(var(--frenz-safe-top)+7rem)]">
        <h1 className="mb-6 text-center text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">
          Profile
        </h1>
        <LoginPersonalizeCard />
      </main>
      <SiteFooter />
    </div>
  );
}
