import { after, NextResponse } from "next/server";
import { z } from "zod";

import { type PushPriority, sendSmartPush } from "@/lib/notifications/smart-delivery";
import { messageLimiter } from "@/lib/rate-limit";
import { parseMentionedHandles } from "@/lib/social/message-meta";
import { ALLOWED_MIME, MAX_ATTACHMENTS_PER_MESSAGE, MAX_SIZE_BYTES } from "@/lib/social/message-media";
import { listConversations, sendMessage, type AttachmentInput } from "@/lib/social/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/messages — the signed-in user's inbox (powers the live badge + list). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ conversations: [] });

  const conversations = await listConversations(user.id);
  const unread = conversations.filter((c) => c.unread).length;
  return NextResponse.json({ conversations, unread });
}

// `.url()` alone only checks shape — it happily accepts any external URL
// (https://evil.example/malware.exe), which would let a message attach a
// link to somewhere we never uploaded anything, styled as a trusted-looking
// attachment card. Every attachment must actually point at OUR OWN storage
// (R2's public base, or Supabase Storage's public-object path) — the same
// place `uploadPostMedia`/`uploadWithPlan` always upload to.
function isOwnStorageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const r2Base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (r2Base && url.startsWith(r2Base)) return true;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl) {
      const supabaseHost = new URL(supabaseUrl).host;
      if (u.host === supabaseHost && u.pathname.startsWith("/storage/v1/object/public/")) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Re-validated here even though the composer already checked before
// uploading — this route never trusts the client, same as every other
// upload-adjacent endpoint in this app.
const attachmentSchema = z
  .object({
    mediaKind: z.enum(["image", "video", "audio", "document"]),
    mediaUrl: z.string().url(),
    thumbnailUrl: z.string().url().optional(),
    mediaWidth: z.number().int().positive().optional(),
    mediaHeight: z.number().int().positive().optional(),
    durationMs: z.number().int().positive().optional(),
    waveform: z.array(z.number()).max(200).optional(),
    filename: z.string().max(255).optional(),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().positive().optional(),
  })
  .refine((a) => isOwnStorageUrl(a.mediaUrl), { message: "Invalid media URL." })
  .refine((a) => a.thumbnailUrl === undefined || isOwnStorageUrl(a.thumbnailUrl), { message: "Invalid thumbnail URL." })
  .refine((a) => a.sizeBytes === undefined || a.sizeBytes <= MAX_SIZE_BYTES[a.mediaKind], { message: "File too large." })
  .refine((a) => a.mimeType === undefined || ALLOWED_MIME[a.mediaKind].includes(a.mimeType), { message: "Unsupported file type." });

const schema = z
  .object({
    conversationId: z.string().uuid(),
    // Base64 AES-GCM ciphertext (Secret Chats) runs longer than the 2000-char
    // plaintext cap — sendMessage() applies the precise per-case limit;
    // this is just a generous upper bound against abuse.
    body: z.string().trim().max(2800).default(""),
    replyToId: z.string().uuid().optional(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
    // Idempotency key: the offline-queue (or a flaky-network retry) can safely
    // replay the exact same POST — sendMessage() dedupes on this instead of
    // creating a second message.
    clientId: z.string().max(100).optional(),
    clientSentAt: z.string().datetime().optional(),
    // Secret Chats only (Part 11b) — the AES-GCM nonce for `body`.
    encryptionIv: z.string().max(64).optional(),
  })
  .refine((v) => v.body.trim().length > 0 || (v.attachments?.length ?? 0) > 0, { message: "Write a message or attach something." });

/** POST /api/messages — send a message in a conversation (direct or group). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { success } = await messageLimiter.limit(`msg:${user.id}`);
  if (!success) return NextResponse.json({ error: "You're sending messages too fast." }, { status: 429 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Write a message." }, { status: 400 });

  const res = await sendMessage(user.id, parsed.data.conversationId, parsed.data.body, {
    replyToId: parsed.data.replyToId,
    clientId: parsed.data.clientId,
    clientSentAt: parsed.data.clientSentAt,
    attachments: parsed.data.attachments as AttachmentInput[] | undefined,
    encryptionIv: parsed.data.encryptionIv,
  });
  if (!res.ok) {
    const message = res.reason === "admins_only" ? "Only admins can send messages in this group." : "Couldn't send (blocked or unavailable).";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Web push to every other active member so a message reaches them with the
  // site closed — skipped on a deduped replay, since the original send
  // already pushed (an offline-queue retry must never double-notify).
  if (!res.duplicate) {
    // after(), not bare void — a fire-and-forget call started right before
    // this Route Handler returns isn't guaranteed to finish; Vercel can
    // freeze the function the instant the response is sent, deferring the
    // actual push send until some unrelated later request happens to reuse
    // the same warm instance (anywhere from seconds to minutes later, or
    // never). This is the real cause behind "push notifications arrive
    // minutes late" — found 2026-07-12.
    after(() => notifyMembers(user.id, parsed.data.conversationId, parsed.data.body, parsed.data.attachments));
  }

  return NextResponse.json({ ok: true, id: res.id, duplicate: res.duplicate ?? false });
}

/**
 * Best-effort: resolve every other active member + sender name and push them
 * the message. Every millisecond here is added latency before the push even
 * leaves our server (separate from — and much smaller than — the delivery
 * hop itself), so the member lookup, sender-profile lookup, and burst check
 * run in PARALLEL rather than sequentially.
 *
 * Smart delivery: a mention (or any direct-thread message) is `high`
 * priority — always pushed, even during the recipient's Do Not Disturb;
 * a plain group message is `medium` — held back during DND (still lands
 * in-app via Realtime + the Notification Center). A burst of several
 * messages in the last minute collapses into one "N new messages" push
 * instead of spamming one per message (the existing `tag` already makes a
 * newer push REPLACE the last one at the OS level — this makes the
 * REPLACEMENT say something truthful about the burst, not just show
 * whichever message happened to be last).
 */
/** A push preview needs SOME text even for an attachment-only send. */
function previewFor(body: string, attachments: AttachmentInput[] | undefined): string {
  const text = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  if (!attachments || attachments.length === 0) return text;
  const kind = attachments[0]!.mediaKind;
  const label =
    attachments.length > 1
      ? `${attachments.length} attachments`
      : kind === "image"
        ? "📷 Photo"
        : kind === "video"
          ? "🎥 Video"
          : kind === "audio"
            ? "🎤 Voice message"
            : `📄 ${attachments[0]!.filename || "File"}`;
  return text ? `${label} · ${text}` : label;
}

async function notifyMembers(senderId: string, conversationId: string, body: string, attachments?: AttachmentInput[]): Promise<void> {
  try {
    const db = createAdminClient();
    const [{ data: conv }, { data: memberRows }, { data: sender }, { count: burstCount }] = await Promise.all([
      db.from("conversations").select("type").eq("id", conversationId).maybeSingle(),
      db.from("conversation_members").select("user_id").eq("conversation_id", conversationId).is("left_at", null).neq("user_id", senderId),
      db.from("profiles").select("display_name, handle, avatar_url").eq("id", senderId).maybeSingle(),
      db
        .from("messages")
        .select("id", { head: true, count: "exact" })
        .eq("conversation_id", conversationId)
        .neq("sender_id", senderId)
        .gte("created_at", new Date(Date.now() - 60_000).toISOString()),
    ]);
    const recipientIds = ((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id);
    if (recipientIds.length === 0) return;

    const mentionedHandles = parseMentionedHandles(body);
    let mentionedRecipientIds = new Set<string>();
    if (mentionedHandles.length > 0) {
      const { data: recipientProfiles } = await db.from("profiles").select("id, handle").in("id", recipientIds);
      const idByHandle = new Map(
        ((recipientProfiles ?? []) as { id: string; handle: string | null }[])
          .filter((p) => p.handle)
          .map((p) => [p.handle!.toLowerCase(), p.id]),
      );
      mentionedRecipientIds = new Set(mentionedHandles.map((h) => idByHandle.get(h)).filter((id): id is string => !!id));
    }

    const name = (sender?.display_name as string) || (sender?.handle ? `@${sender.handle as string}` : "New message");
    const isGroup = conv?.type === "group";
    const isSecret = conv?.type === "secret";
    const isBurst = (burstCount ?? 0) > 1;
    // Secret Chats: `body` is ciphertext at this point — the server cannot
    // decrypt it to build a real preview, and a raw base64 blob in a push
    // notification would look broken (and defeat the whole point of
    // encrypting it). Always a generic label here, regardless of the
    // recipient's own "hide preview" notification setting.
    const preview = isSecret ? "New encrypted message" : isBurst ? `${burstCount} new messages` : previewFor(body, attachments);

    await Promise.all(
      recipientIds.map((recipientId) => {
        const mentioned = mentionedRecipientIds.has(recipientId);
        const priority: PushPriority = mentioned || !isGroup ? "high" : "medium";
        return sendSmartPush(
          recipientId,
          {
            title: mentioned ? `${name} mentioned you` : name,
            body: preview,
            genericBody: mentioned ? "You were mentioned" : "New message",
            url: isSecret ? `/messages/secret/${conversationId}` : `/messages/${conversationId}`,
            icon: (sender?.avatar_url as string | null) ?? undefined,
            tag: `msg:${conversationId}`,
            conversationId,
            actions: [
              { action: "mark_read", title: "Mark as read" },
              { action: "mute", title: "Mute" },
            ],
          },
          priority,
          "social",
        );
      }),
    );
  } catch {
    /* push is best-effort */
  }
}
