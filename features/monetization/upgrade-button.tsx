"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useUser } from "@/features/auth/use-user";

/**
 * Starts a subscription upgrade. Anyone can click it (signed in or not):
 * - not signed in → straight to sign-up (with a return to /pricing), no waiting
 *   on a billing call first;
 * - signed in → Paystack checkout.
 */
export function UpgradeButton({
  plan,
  className,
  children,
}: {
  plan: "pro" | "business";
  className?: string;
  children: React.ReactNode;
}) {
  const { user, enabled } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    // Anonymous → sign up immediately, then come back to pricing.
    if (enabled && !user) {
      window.location.href = `/login?signup=1&next=${encodeURIComponent("/pricing")}`;
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (res.status === 401 && json.login) {
        window.location.href = `/login?signup=1&next=${encodeURIComponent("/pricing")}`;
        return;
      }
      if (json.url) {
        window.location.href = json.url as string;
        return;
      }
      setError(json.error ?? "Couldn't start checkout.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" onClick={go} disabled={loading} className={className}>
        {loading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : children}
      </button>
      {error ? <p className="mt-2 text-center text-xs text-red-400">{error}</p> : null}
    </>
  );
}
