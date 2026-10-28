import { NextResponse } from "next/server";

import { getVerificationState, recordVerificationEvent } from "@/lib/social/verification";
import { getPaidVerificationConfig } from "@/lib/social/paid-verification";
import { VERIFICATION_CATEGORIES } from "@/lib/social/verification-shared";
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

/*
  The verification flow (design/frenz-verification.html, owner 2026-10-28: "don't add the ID step"): who you are
  (account type, legal name, date of birth, country, company or publication, links), a selfie, then — when the admin
  has priced the tick — payment, then review. No ID document is asked for.

  With the paid tick ON the application is saved as a DRAFT and goes to review only once paid (paid-verification.ts
  grantPaidTick). With it OFF it goes to review now. Sending the form again while a draft waits for payment updates it.
*/
interface Body {
  category?: string;
  legalName?: string;
  dateOfBirth?: string;
  country?: string;
  organization?: string | null;
  links?: string | null;
  selfiePath?: string;
}

const CATEGORIES = new Set(VERIFICATION_CATEGORIES.map((c) => c.value as string));

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** A real calendar date, in the past, and an applicant of at least 13 (the platform's own minimum age). */
function validDob(v: string): boolean {
  if (!/^d{4}-d{2}-d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || d.getUTCFullYear() < 1900) return false;
  const thirteen = new Date();
  thirteen.setUTCFullYear(thirteen.getUTCFullYear() - 13);
  return d <= thirteen;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("Sign in to apply.", 401);

  const state = await getVerificationState(user.id);
  if (state.verified && state.request?.decisionReason !== "Paid verification") return bad("Your account is already verified.");
  if (state.request && (state.request.status === "pending" || state.request.status === "in_review")) {
    return bad("You already have an application under review.");
  }

  const admin = createAdminClient();
  const { data: who } = await admin.from("profiles").select("is_suspended, display_name").eq("id", user.id).maybeSingle();
  if ((who as { is_suspended?: boolean } | null)?.is_suspended) return bad("This account can't be verified.", 403);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Malformed request.");
  }

  const category = body.category && CATEGORIES.has(body.category) ? body.category : null;
  const legalName = (body.legalName ?? "").trim().replace(/s+/g, " ");
  const dob = (body.dateOfBirth ?? "").trim();
  const country = (body.country ?? "").trim();
  const organization = (body.organization ?? "").trim().slice(0, 120) || null;
  const links = (body.links ?? "").trim().slice(0, 500);

  if (!category) return bad("Choose the account type that fits you best.");
  if (legalName.split(" ").filter(Boolean).length < 2 || legalName.length > 120) return bad("Enter your first and last name.");
  if (!validDob(dob)) return bad("Enter a valid date of birth.");
  if (country.length < 2 || country.length > 60) return bad("Select your country.");
  if (category === "business" && !organization) return bad("Enter the registered company name.");
  if (category === "journalist" && !organization) return bad("Enter the publication you report for.");
  if (!body.selfiePath || !body.selfiePath.startsWith(`${user.id}/`)) return bad("Take a selfie to continue.");

  const offer = await getPaidVerificationConfig();
  const now = new Date().toISOString();
  const row = {
    category,
    legal_name: legalName,
    known_as: (who?.display_name as string | null) ?? null,
    date_of_birth: dob,
    country,
    organization,
    links: links ? links.split(/[s,]+/).filter(Boolean).slice(0, 5) : [],
    selfie_path: body.selfiePath,
    status: offer.enabled ? "draft" : "pending",
    submitted_at: offer.enabled ? null : now,
    updated_at: now,
  };

  // a draft waiting for payment is updated in place (the one-open index allows one)
  const { data: draft } = await admin.from("verification_requests").select("id").eq("user_id", user.id).eq("status", "draft").maybeSingle();
  const write = draft?.id
    ? admin.from("verification_requests").update(row).eq("id", draft.id as string).select("id").maybeSingle()
    : admin.from("verification_requests").insert({ user_id: user.id, ...row }).select("id").maybeSingle();
  const { data, error } = await write;
  if (error) {
    if (error.code === "23505") return bad("You already have an application in progress.");
    // 0302 adds date_of_birth and organization
    if (/date_of_birth|organization|column/i.test(error.message)) return bad("Verification is being updated. Try again in a few minutes.", 503);
    return bad("Couldn't save your application.", 500);
  }
  if (data?.id) await recordVerificationEvent(data.id as string, user.id, "user", offer.enabled ? "details_saved" : "submitted");
  return NextResponse.json({ ok: true, next: offer.enabled ? "pay" : "review" });
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
