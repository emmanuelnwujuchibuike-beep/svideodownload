import { z } from "zod";

import { getSessionUser } from "@/lib/api/authenticate";
import { corsPreflight } from "@/lib/api/cors";
import { fail, ok } from "@/lib/api/respond";
import { planClientUpload } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

const schema = z.object({
  kind: z.enum(["video", "audio", "image"]),
  ext: z.string().min(1).max(5),
});

/**
 * POST /api/uploads/presign — returns an upload plan for post/reel/story media.
 * Auth works for web (cookie) and native/desktop (bearer). If R2 is configured
 * the client receives a short-lived presigned PUT URL (uploads straight to R2);
 * otherwise it gets a Supabase object key to upload via the Supabase SDK.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return fail("unauthorized", "Sign in to upload.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("bad_request", "Invalid JSON body.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("validation_failed", "A valid `kind` and `ext` are required.");

  try {
    const plan = await planClientUpload(user.id, parsed.data.kind, parsed.data.ext);
    return ok(plan);
  } catch {
    return fail("internal", "Couldn't prepare the upload.");
  }
}
