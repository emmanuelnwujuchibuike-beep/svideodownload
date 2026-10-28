import { NextResponse } from "next/server";

import {
  changeDashboardPassword,
  checkDashboardPassword,
  checkDashboardPin,
  completePinReset,
  completeSetup,
  endAdminLockSession,
  requestPinReset,
  requestSetupLink,
} from "@/lib/admin/lock";
import { getAdminIdentity, getAdminUser } from "@/lib/admin/require-admin";
import { sendAdminLockLinkEmail } from "@/lib/email/resend";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/lock — the admin dashboard lock (0301, lib/admin/lock.ts).
 *
 * The one admin route that answers a LOCKED administrator: it is how they unlock. Everything is decided by role
 * (getAdminIdentity) and then by the database's counted attempts; a non-admin gets the same 404 as every admin route.
 * Changing the password needs an UNLOCKED dashboard (getAdminUser).
 *
 *   { action: "password", password }                       step 1
 *   { action: "pin", pin }                                 step 2
 *   { action: "lock" }                                     end this browser's session
 *   { action: "setup_link" }                               first time: email a setup link (always { ok: true })
 *   { action: "setup", token, password, password2, pin, pin2 }
 *   { action: "reset_request", current, previous }         PIN reset: the passwords, then an emailed link
 *   { action: "reset_complete", token, pin, pin2 }         from the link: the new PIN
 *   { action: "change_password", current, next, next2 }    unlocked only
 */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function POST(req: Request) {
  const admin = await getAdminIdentity();
  if (!admin) return notFound();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // links always point at the canonical site, never at a Host header a request could forge
  const send = (purpose: "setup" | "pin_reset") => (url: string, minutes: number) =>
    admin.email ? sendAdminLockLinkEmail(admin.email, purpose, url, minutes) : Promise.resolve(false);

  let r: { ok: true } | { ok: false; status: number; error: string; reason: string };
  switch (body.action) {
    case "password":
      r = await checkDashboardPassword(admin.id, body.password);
      break;
    case "pin":
      r = await checkDashboardPin(admin.id, body.pin);
      break;
    case "lock":
      await endAdminLockSession(admin.id);
      return NextResponse.json({ ok: true });
    case "setup_link": {
      await requestSetupLink(admin.id, SITE_URL, send("setup"));
      // the same answer whether a link was sent, the lock is already set, or the hourly limit was hit
      return NextResponse.json({ ok: true });
    }
    case "setup":
      r = await completeSetup(admin.id, body.token, body.password, body.password2, body.pin, body.pin2);
      break;
    case "reset_request":
      r = await requestPinReset(admin.id, body.current, body.previous, SITE_URL, send("pin_reset"));
      break;
    case "reset_complete":
      r = await completePinReset(admin.id, body.token, body.pin, body.pin2);
      break;
    case "change_password": {
      if (!(await getAdminUser())) return NextResponse.json({ error: "locked", unlock: "/admin/unlock" }, { status: 423 });
      r = await changeDashboardPassword(admin.id, body.current, body.next, body.next2);
      break;
    }
    default:
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (r.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: r.error, reason: r.reason }, { status: r.status });
}
