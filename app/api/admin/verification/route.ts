import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import {
  approveVerification,
  issueVerificationDirectly,
  rejectVerification,
  revokeVerification,
  signedDocumentUrls,
} from "@/lib/social/verification";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/verification — the reviewer's actions.
 *
 *   approve  — grant the tick against a submitted application
 *   reject   — decline it with a code and a reason
 *   issue    — grant it DIRECTLY, with no application at all (owner: "admin can
 *              issue directly to skip all the processes")
 *   revoke   — take it back
 *   documents— mint short-lived signed URLs for one request's images
 *
 * Every branch is behind `getAdminUser`, and every branch writes a
 * verification_events row naming the admin who did it. Document URLs are minted
 * here rather than embedded in the page so they expire in 5 minutes instead of
 * living in the HTML.
 */

interface Body {
  action?: "approve" | "reject" | "issue" | "revoke" | "documents";
  requestId?: string;
  userId?: string;
  handle?: string;
  code?: string;
  reason?: string;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request.");
  }

  const reason = (body.reason ?? "").trim();

  switch (body.action) {
    case "approve": {
      if (!body.requestId) return bad("Missing request.");
      const r = await approveVerification(body.requestId, admin.id, reason);
      return r.ok ? NextResponse.json({ ok: true }) : bad(r.error ?? "Failed.", 500);
    }

    case "reject": {
      if (!body.requestId) return bad("Missing request.");
      if (!body.code) return bad("Choose a reason code.");
      const r = await rejectVerification(body.requestId, admin.id, body.code, reason);
      return r.ok ? NextResponse.json({ ok: true }) : bad(r.error ?? "Failed.", 500);
    }

    case "issue": {
      // Accept either a user id or a handle, so the operator can just type the
      // @name they already know.
      let userId = body.userId ?? null;
      if (!userId && body.handle) {
        const { data } = await createAdminClient()
          .from("profiles")
          .select("id")
          .eq("handle", body.handle.replace(/^@/, "").trim().toLowerCase())
          .maybeSingle();
        userId = (data?.id as string | undefined) ?? null;
      }
      if (!userId) return bad("No account found for that username.");
      const r = await issueVerificationDirectly(userId, admin.id, reason);
      return r.ok ? NextResponse.json({ ok: true }) : bad(r.error ?? "Failed.", 500);
    }

    case "revoke": {
      if (!body.userId) return bad("Missing account.");
      if (!reason) return bad("A reason is required to revoke a tick.");
      const r = await revokeVerification(body.userId, admin.id, reason);
      return r.ok ? NextResponse.json({ ok: true }) : bad(r.error ?? "Failed.", 500);
    }

    case "documents": {
      if (!body.requestId) return bad("Missing request.");
      const { data } = await createAdminClient()
        .from("verification_requests")
        .select("id_front_path, id_back_path, selfie_path")
        .eq("id", body.requestId)
        .maybeSingle();
      if (!data) return bad("Request not found.", 404);
      const urls = await signedDocumentUrls({
        idFrontPath: (data.id_front_path as string | null) ?? null,
        idBackPath: (data.id_back_path as string | null) ?? null,
        selfiePath: (data.selfie_path as string | null) ?? null,
      });
      return NextResponse.json({ ok: true, urls });
    }

    default:
      return bad("Unknown action.");
  }
}
