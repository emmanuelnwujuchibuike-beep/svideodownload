"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

/** Starts Stripe Checkout for a plan; routes to login if needed. */
export function UpgradeButton({
  plan,
  className,
  children,
}: {
  plan: "pro" | "business";
  className?: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
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
        window.location.href = "/login?next=/pricing";
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
