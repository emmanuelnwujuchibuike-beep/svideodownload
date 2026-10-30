"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/**
 * The footer's signed-in doors — Reels and Community (/home). Both are app-only routes (lib/auth/app-only-paths.ts),
 * so a guest's HTML never carries them: the static footer renders nothing here and a visitor with an auth cookie gets
 * the two links after hydration. A cookie check, no request.
 */
export function FooterMemberLinks() {
  const [member, setMember] = useState(false);
  useEffect(() => setMember(hasAuthCookie()), []);
  if (!member) return null;
  return (
    <>
      <li>
        <Link href="/reels" className="transition-colors hover:text-foreground">
          Reels
        </Link>
      </li>
      <li>
        <Link href="/home" className="transition-colors hover:text-foreground">
          Community
        </Link>
      </li>
    </>
  );
}
