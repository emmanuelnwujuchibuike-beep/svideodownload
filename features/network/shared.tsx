"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";

import { PersonAvatar } from "@/features/friends/ui";
import { PRO_ROLES, type ProRole } from "@/lib/social/professional/engine";
import type { ProPerson } from "@/lib/social/professional/server";

/** One write to /api/network. Returns the error in words, or null. */
export async function networkPost(body: Record<string, unknown>): Promise<{ error: string | null; data: Record<string, unknown> | null }> {
  const res = await fetch("/api/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null;
  if (res?.ok) return { error: null, data };
  return { error: (data?.error as string | undefined) ?? (res ? "Couldn't save that." : "You're offline."), data: null };
}

export function roleLabel(role: ProRole, custom: string | null): string {
  return role === "custom" ? custom ?? "Connection" : PRO_ROLES[role];
}

export function PersonLine({ p, sub, href }: { p: ProPerson; sub?: string | null; href?: string }) {
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <PersonAvatar user={p} size={44} />
      <span className="min-w-0">
        <span className="flex items-center gap-1">
          <span className="truncate text-[14.5px] font-semibold">{p.displayName}</span>
          {p.verified ? <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-label="Verified" /> : null}
        </span>
        <span className="block truncate text-[12.5px] text-muted-foreground">{sub ?? p.headline ?? `@${p.handle}`}</span>
      </span>
    </span>
  );
  return href ? (
    <Link href={href} prefetch={false} className="min-w-0 flex-1 rounded-xl transition active:opacity-70">
      {body}
    </Link>
  ) : (
    <span className="min-w-0 flex-1">{body}</span>
  );
}
