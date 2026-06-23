"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

/** Opens the Stripe billing portal so the member can update or cancel. */
export function ManageBillingButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url as string;
        return;
      }
      setError(json.error ?? "Couldn't open billing.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" onClick={open} disabled={loading} className={className}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
      </button>
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </>
  );
}
