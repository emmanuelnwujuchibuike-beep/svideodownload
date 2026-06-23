import { CalendarDays, Crown, LogOut, Mail, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ManageBillingButton } from "@/features/monetization/manage-billing-button";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function AccountPage() {
  if (!hasSupabase) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, avatar_url, created_at")
    .eq("id", user.id)
    .single();

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_end, cancel_at_period_end, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const planActive = sub?.status === "active" || sub?.status === "trialing";
  const plan = (planActive ? sub?.plan : "free") ?? "free";
  const planLabel = plan === "business" ? "Business" : plan === "pro" ? "Pro" : "Free";
  const hasCustomer = !!sub?.stripe_customer_id;

  const email = user.email ?? "—";
  const avatar =
    (user.user_metadata?.avatar_url as string | undefined) ||
    profile?.avatar_url ||
    null;
  const admin = isAdmin(profile?.role, user.email);
  const created = profile?.created_at ?? user.created_at;
  const initial = email.charAt(0).toUpperCase();

  return (
    <>
      <SiteHeader />
      <main className="container max-w-2xl pb-24 pt-32 sm:pt-40">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Your account
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage your profile and session.
          </p>
        </header>

        <div className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8">
          <div className="flex items-center gap-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatar}
                alt=""
                className="h-16 w-16 rounded-full object-cover ring-2 ring-border"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-2xl font-bold text-white">
                {initial}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{email}</p>
              {admin ? (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  <ShieldCheck className="h-3 w-3" /> Admin
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {planLabel} account
                </span>
              )}
            </div>
          </div>

          {/* Plan / billing */}
          <div className="mt-7 flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-secondary/30 p-4">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                plan === "free" ? "bg-secondary text-muted-foreground" : "bg-primary/15 text-primary",
              )}
            >
              <Crown className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{planLabel} plan</p>
              <p className="text-xs text-muted-foreground">
                {plan === "free"
                  ? "Upgrade for an ad-free, faster experience."
                  : sub?.cancel_at_period_end
                    ? `Cancels on ${sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "period end"}`
                    : sub?.current_period_end
                      ? `Renews ${new Date(sub.current_period_end).toLocaleDateString()}`
                      : "Active"}
              </p>
            </div>
            {plan === "free" ? (
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Upgrade
              </Link>
            ) : hasCustomer ? (
              <ManageBillingButton className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition hover:bg-secondary disabled:opacity-60" />
            ) : null}
          </div>

          <dl className="mt-7 grid gap-4 border-t border-border/60 pt-6 sm:grid-cols-2">
            <Detail icon={Mail} label="Email" value={email} />
            <Detail
              icon={CalendarDays}
              label="Member since"
              value={created ? new Date(created).toLocaleDateString() : "—"}
            />
          </dl>

          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-border/60 pt-6">
            <Link
              href="/#download"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              Download a video
            </Link>
            {admin ? (
              <Link
                href="/admin"
                className="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-secondary"
              >
                Admin dashboard
              </Link>
            ) : null}
            <form action="/auth/signout" method="post" className="ml-auto">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-red-500/40 hover:text-red-400"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium">{value}</dd>
      </div>
    </div>
  );
}
