import { NextResponse } from "next/server";

import { getVerificationState, recordVerificationEvent } from "@/lib/social/verification";
import { ID_DOCUMENT_TYPES, VERIFICATION_CATEGORIES } from "@/lib/social/verification-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/verification — submit a verification application.
 * DELETE /api/verification — withdraw the one in flight.
 *
 * 🔴 No eligibility rules (owner, 2026-10-24: "users should be able to pay for verification not being eligible …
 * remove every eligibility there on the verification"). Any signed-in member may apply; only a suspended account is
 * refused (the same rule paid checkout applies). The decision is the reviewer's.
 *
 * Document paths are validated to live inside the caller's OWN folder in the
 * private bucket before they are stored — otherwise an applicant could submit a
 * path pointing at somebody else's upload and have a reviewer approve them
 * against a stranger's passport.
 */

interface Body {
  category?: string;
  legalName?: string;
  country?: string;
  idDocumentType?: string;
  idNumberLast4?: string;
  idFrontPath?: string;
  idBackPath?: string | null;
  selfiePath?: string;
  statement?: string | null;
}

const CATEGORIES = new Set(VERIFICATION_CATEGORIES.map((c) => c.value as string));
const DOC_TYPES = new Set(ID_DOCUMENT_TYPES.map((d) => d.value as string));

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("Sign in to apply.", 401);

  const state = await getVerificationState(user.id);
  if (state.verified) return bad("Your account is already verified.");
  if (state.request && (state.request.status === "pending" || state.request.status === "in_review")) {
    return bad("You already have an application under review.");
  }

  const { data: who } = await createAdminClient().from("profiles").select("is_suspended").eq("id", user.id).maybeSingle();
  if ((who as { is_suspended?: boolean } | null)?.is_suspended) return bad("This account can't be verified.", 403);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request.");
  }

  const category = body.category && CATEGORIES.has(body.category) ? body.category : null;
  const docType = body.idDocumentType && DOC_TYPES.has(body.idDocumentType) ? body.idDocumentType : null;
  const legalName = (body.legalName ?? "").trim();
  const country = (body.country ?? "").trim();
  const last4 = (body.idNumberLast4 ?? "").trim().slice(-4);

  if (!category) return bad("Choose a category.");
  if (!docType) return bad("Choose a document type.");
  if (legalName.length < 3) return bad("Enter your full legal name as printed on the document.");
  if (country.length < 2) return bad("Enter the country that issued the document.");
  if (last4.length < 3) return bad("Enter the last 4 characters of the document number.");

  // Every submitted path must sit in THIS user's folder in the private bucket.
  const own = (p: string | null | undefined) => !!p && p.startsWith(`${user.id}/`);
  if (!own(body.idFrontPath)) return bad("Upload the front of your document.");
  if (docType !== "passport" && !own(body.idBackPath)) return bad("Upload the back of your document.");
  if (body.idBackPath && !own(body.idBackPath)) return bad("That document image isn't yours.");
  if (!own(body.selfiePath)) return bad("Take your security selfie.");

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // The profile's display name is the name they'll be verified UNDER, captured
  // at submission so a later rename is visible to the reviewer as a change.
  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();

  const { data, error } = await admin
    .from("verification_requests")
    .insert({
      user_id: user.id,
      status: "pending",
      category,
      legal_name: legalName,
      known_as: (profile?.display_name as string | null) ?? null,
      country,
      id_document_type: docType,
      id_number_last4: last4,
      id_front_path: body.idFrontPath,
      id_back_path: body.idBackPath ?? null,
      selfie_path: body.selfiePath,
      statement: (body.statement ?? "").trim() || null,
      submitted_at: now,
      updated_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // The partial unique index is the authority on "one open application".
    if (error.code === "23505") return bad("You already have an application in progress.");
    return bad(error.message, 500);
  }

  if (data?.id) await recordVerificationEvent(data.id as string, user.id, "user", "submitted");
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("Sign in first.", 401);

  const { error } = await createAdminClient()
    .from("verification_requests")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .in("status", ["draft", "pending", "in_review"]);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
