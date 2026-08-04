import { NextResponse } from "next/server";
import { z } from "zod";

import { canDesignate, MAX_TRUSTED_CONTACTS } from "@/lib/social/graph/trusted";
import { listTrustedContacts } from "@/lib/social/graph/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.object({
  contactId: z.string().regex(UUID),
  capability: z.string().min(1).max(32),
  note: z.string().max(280).nullable().optional(),
});

/**
 * Trusted contacts — a RECORD of who matters, granting nothing.
 *
 * `canDesignate` is the guard, and it currently allows only `emergency` and
 * `legacy`. Account recovery and delegated access are refused here as well as
 * being absent from the CHECK constraint in 0112 — two independent refusals,
 * because the cost of one of them being loosened by accident is somebody else
 * getting into an account.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ contacts: await listTrustedContacts(user.id) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { contactId, capability, note } = parsed.data;
  if (contactId === user.id) return NextResponse.json({ error: "Choose somebody else." }, { status: 400 });
  if (!canDesignate(capability)) {
    return NextResponse.json({ error: "That kind of trusted contact isn't available." }, { status: 400 });
  }

  const existing = await listTrustedContacts(user.id);
  if (existing.length >= MAX_TRUSTED_CONTACTS) {
    return NextResponse.json({ error: `You can name up to ${MAX_TRUSTED_CONTACTS} people.` }, { status: 400 });
  }

  try {
    const { error } = await createAdminClient()
      .from("trusted_contacts")
      .upsert(
        { owner_id: user.id, contact_id: contactId, capability, note: note ?? null },
        { onConflict: "owner_id,contact_id,capability" },
      );
    if (error) {
      return NextResponse.json(
        { error: "Trusted contacts aren't available yet. Ask an admin to apply the latest database update." },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  try {
    const { error } = await createAdminClient()
      .from("trusted_contacts")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id);
    if (error) return NextResponse.json({ error: "Couldn't remove that." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't remove that." }, { status: 500 });
  }
}
