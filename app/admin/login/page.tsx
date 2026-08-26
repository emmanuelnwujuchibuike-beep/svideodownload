import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminLoginForm } from "@/features/admin/admin-login-form";
import { getAdminUser } from "@/lib/admin/require-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin sign in",
  // 🔴 Never indexed. A login form in a search index is a free advertisement
  // that this origin has an admin panel, and where it is.
  robots: { index: false, follow: false, nocache: true },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * `/admin/login` — the ONLY page under `/admin` that an unauthenticated visitor
 * may render. The middleware allowlists this exact path; everything else under
 * `/admin/*` redirects here.
 *
 * An administrator who is ALREADY signed in never sees this form — they are
 * sent straight through, so a bookmarked login URL behaves like a bookmark of
 * the dashboard rather than an invitation to type a password that is not
 * needed.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  if (!hasSupabase) redirect("/");

  const admin = await getAdminUser();
  if (admin) redirect(safeNext(next));

  return <AdminLoginForm next={safeNext(next)} />;
}

/**
 * 🔴 OPEN-REDIRECT GUARD.
 *
 * `?next=` is attacker-controlled: a link to
 * `/admin/login?next=https://evil.example` would, after a successful sign-in,
 * bounce the administrator to another origin — the classic phishing hand-off,
 * made credible because it starts on the real site.
 *
 * Only a same-origin path under `/admin` is accepted. `//evil.example` is
 * rejected too: the browser reads a protocol-relative URL as another origin,
 * and it starts with a single `/`, so a naive `startsWith("/")` check would let
 * it through.
 */
function safeNext(next?: string): string {
  if (!next) return "/admin";
  if (!next.startsWith("/admin")) return "/admin";
  if (next.startsWith("//")) return "/admin";
  return next;
}
