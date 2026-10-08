"use client";

import { Megaphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AiButtonLink } from "@/features/ai/design/ai-button";
import { AiPanel } from "@/features/ai/design/ai-surface";
import { useUser } from "@/features/auth/use-user";
import { getClient } from "@/lib/supabase/client-lazy";

import { Chip, Row } from "./advertise-ui";

/**
 * The advertiser's campaigns, read straight from Postgres with their own
 * session — RLS (0195) returns only their rows. No Vercel function. Every
 * number here (status, payment, duration, bonus, start, end) is the server's.
 */

interface Campaign {
  id: string;
  name: string;
  status: string;
  duration_days: number | null;
  extra_days: number;
  start_at: string | null;
  end_at: string | null;
  payment_verified_at: string | null;
  total_amount_minor: number | null;
  currency: string | null;
  created_at: string;
  ad_placements: { name: string; format_code: string } | null;
}

const LABEL: Record<string, { text: string; tone: "emerald" | "indigo" | "amber" | "rose" | "slate" }> = {
  active: { text: "LIVE", tone: "emerald" },
  paid: { text: "Going live", tone: "indigo" },
  validating: { text: "Under review", tone: "amber" },
  payment_processing: { text: "Payment processing", tone: "indigo" },
  awaiting_payment: { text: "Ready for payment", tone: "indigo" },
  draft: { text: "Draft", tone: "slate" },
  paused: { text: "Paused", tone: "amber" },
  expired: { text: "Ended", tone: "slate" },
  rejected: { text: "Rejected", tone: "rose" },
  removed: { text: "Removed", tone: "rose" },
  cancelled: { text: "Cancelled", tone: "slate" },
};
const date = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function MyCampaigns() {
  const { user, loading } = useUser();
  const [rows, setRows] = useState<Campaign[] | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const sb = await getClient();
        const { data } = await sb
          .from("ad_campaigns")
          .select("id, name, status, duration_days, extra_days, start_at, end_at, payment_verified_at, total_amount_minor, currency, created_at, ad_placements(name, format_code)")
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(50);
        setRows((data ?? []) as unknown as Campaign[]);
      } catch {
        setRows([]);
      }
    })();
  }, [user]);

  if (!loading && !user) {
    return (
      <AiPanel className="text-center">
        <p className="text-[15px] font-semibold">Sign in to see your campaigns</p>
        <Link href={`/login?next=${encodeURIComponent("/advertise/campaigns")}`} prefetch={false} className="ai-btn ai-btn--primary mt-4 inline-flex">
          Sign in
        </Link>
      </AiPanel>
    );
  }
  if (rows === null) return <div className="space-y-3" aria-busy>{[0, 1].map((i) => <span key={i} className="block h-40 animate-pulse rounded-[1.75rem] bg-slate-100" />)}</div>;
  if (rows.length === 0) {
    return (
      <AiPanel className="text-center">
        <Megaphone className="mx-auto h-6 w-6 text-indigo-600" aria-hidden />
        <p className="mt-2 text-[15px] font-semibold">No campaigns yet</p>
        <AiButtonLink href="/advertise/create" prefetch={false} className="mt-4">Create an Ad</AiButtonLink>
      </AiPanel>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((c) => {
        const l = LABEL[c.status] ?? { text: c.status, tone: "slate" as const };
        return (
          <AiPanel key={c.id}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-[15px] font-semibold">{c.name}</p>
              <Chip tone={l.tone}>{l.text}</Chip>
            </div>
            <div className="mt-2">
              <Row label="Payment" value={c.payment_verified_at ? "Paid" : c.status === "payment_processing" ? "Processing" : "Not paid"} />
              <Row label="Placement" value={c.ad_placements?.name ?? "—"} />
              {c.duration_days ? <Row label="Duration" value={`${c.duration_days} days`} /> : null}
              {c.extra_days ? <Row label="Bonus" value={`+${c.extra_days} days`} /> : null}
              {c.duration_days ? <Row label="Total runtime" value={`${c.duration_days + (c.extra_days ?? 0)} days`} /> : null}
              <Row label="Start" value={date(c.start_at)} />
              <Row label="Ends" value={date(c.end_at)} />
            </div>
            {c.status === "draft" || c.status === "awaiting_payment" ? (
              <Link href="/advertise/create" prefetch={false} className="mt-2 inline-flex min-h-[2.75rem] items-center text-[13px] font-semibold text-indigo-700">
                Continue this ad →
              </Link>
            ) : null}
          </AiPanel>
        );
      })}
    </div>
  );
}
