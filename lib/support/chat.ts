import { after } from "next/server";

import { sendProductEmail } from "@/lib/email/resend";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { alertEmailHtml, sendAdminEmail } from "@/lib/notify";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Support Chat — server data layer for the 1:1 member↔admin conversation.
 *
 * All writes run through the service-role client (bypasses RLS) AFTER the caller
 * has been identified in the calling server action (a member via getUser(), an
 * admin via getAdminUser()). The RLS policies in 0101 are the defence-in-depth
 * for any direct browser query; these helpers are the app's real path.
 *
 * Notifications mirror both directions (owner, 2026-08: "make admin receiver
 * notification through push and email notification same with the user"):
 *  - a member's message  → push + email to every admin;
 *  - an admin's reply    → push + email to that member.
 * Both are fired via next/server `after()` so the send never delays the response.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export type SupportRole = "user" | "admin";

export interface SupportMessage {
  id: string;
  senderRole: SupportRole;
  body: string;
  createdAt: string;
}

export interface MySupportThread {
  id: string;
  status: "open" | "closed";
  messages: SupportMessage[];
}

export interface AdminSupportThread {
  id: string;
  userId: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  lastSender: SupportRole | null;
  adminUnread: number;
  status: "open" | "closed";
}

const MAX_BODY = 4000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Trim + clamp a message body; returns null when there's nothing to send. */
export function cleanBody(raw: string): string | null {
  const body = raw.trim().slice(0, MAX_BODY);
  return body.length > 0 ? body : null;
}

function mapMessages(rows: Record<string, unknown>[] | null): SupportMessage[] {
  return (rows ?? []).map((r) => ({
    id: r.id as string,
    senderRole: (r.sender_role as SupportRole) ?? "user",
    body: (r.body as string) ?? "",
    createdAt: r.created_at as string,
  }));
}

/** The member's own thread + full message history (empty when none yet). */
export async function getMyThread(userId: string): Promise<MySupportThread | null> {
  if (!hasSupabase) return null;
  const db = createAdminClient();
  const { data: thread } = await db
    .from("support_threads")
    .select("id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!thread) return null;
  const { data: rows } = await db
    .from("support_messages")
    .select("id, sender_role, body, created_at")
    .eq("thread_id", thread.id as string)
    .order("created_at", { ascending: true })
    .limit(500);
  return {
    id: thread.id as string,
    status: ((thread.status as string) ?? "open") as "open" | "closed",
    messages: mapMessages(rows),
  };
}

/** Member opened their chat — clear the badge for admin replies. */
export async function markMyThreadRead(userId: string): Promise<void> {
  if (!hasSupabase) return;
  const db = createAdminClient();
  await db.from("support_threads").update({ user_unread: 0 }).eq("user_id", userId);
}

async function ensureThread(userId: string): Promise<string> {
  const db = createAdminClient();
  const { data: existing } = await db
    .from("support_threads")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await db
    .from("support_threads")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error || !created) {
    // Lost a race on the unique(user_id) — the row now exists, re-read it.
    const { data: again } = await db
      .from("support_threads")
      .select("id")
      .eq("user_id", userId)
      .single();
    return again!.id as string;
  }
  return created.id as string;
}

/** Member sends a message; bumps the admin's unread and notifies every admin. */
export async function postUserMessage(userId: string, body: string): Promise<SupportMessage | null> {
  if (!hasSupabase) return null;
  const db = createAdminClient();
  const threadId = await ensureThread(userId);
  const { data: msg } = await db
    .from("support_messages")
    .insert({ thread_id: threadId, sender_id: userId, sender_role: "user", body })
    .select("id, sender_role, body, created_at")
    .single();
  const { data: t } = await db
    .from("support_threads")
    .select("admin_unread")
    .eq("id", threadId)
    .single();
  await db
    .from("support_threads")
    .update({
      last_message: body.slice(0, 200),
      last_message_at: new Date().toISOString(),
      last_sender: "user",
      status: "open",
      admin_unread: ((t?.admin_unread as number) ?? 0) + 1,
    })
    .eq("id", threadId);

  after(async () => {
    try {
      await notifyAdminsOfMessage(userId, body);
    } catch {
      /* notifications must never break the send */
    }
  });

  return msg ? (mapMessages([msg])[0] ?? null) : null;
}

/** Admin replies; bumps the member's unread and notifies them by push + email. */
export async function postAdminReply(adminId: string, threadId: string, body: string): Promise<SupportMessage | null> {
  if (!hasSupabase) return null;
  const db = createAdminClient();
  const { data: msg } = await db
    .from("support_messages")
    .insert({ thread_id: threadId, sender_id: adminId, sender_role: "admin", body })
    .select("id, sender_role, body, created_at")
    .single();
  const { data: t } = await db
    .from("support_threads")
    .select("user_id, user_unread")
    .eq("id", threadId)
    .single();
  await db
    .from("support_threads")
    .update({
      last_message: body.slice(0, 200),
      last_message_at: new Date().toISOString(),
      last_sender: "admin",
      status: "open",
      user_unread: ((t?.user_unread as number) ?? 0) + 1,
    })
    .eq("id", threadId);

  const memberId = t?.user_id as string | undefined;
  if (memberId) {
    after(async () => {
      try {
        await notifyMemberOfReply(memberId, body);
      } catch {
        /* never break the reply */
      }
    });
  }
  return msg ? (mapMessages([msg])[0] ?? null) : null;
}

/** Member clears (deletes) their OWN finished conversation + its messages, so the
 *  1:1 support center starts fresh next time. */
export async function clearThreadForUser(userId: string): Promise<void> {
  if (!hasSupabase) return;
  const db = createAdminClient();
  const { data: thread } = await db.from("support_threads").select("id").eq("user_id", userId).maybeSingle();
  if (!thread) return;
  const threadId = thread.id as string;
  await db.from("support_messages").delete().eq("thread_id", threadId);
  await db.from("support_threads").delete().eq("id", threadId);
}

/** Admin deletes a finished support thread and all of its messages. */
export async function deleteThreadById(threadId: string): Promise<void> {
  if (!hasSupabase) return;
  const db = createAdminClient();
  await db.from("support_messages").delete().eq("thread_id", threadId);
  await db.from("support_threads").delete().eq("id", threadId);
}

/** Admin opened a thread — clear its unread count. */
export async function markThreadReadByAdmin(threadId: string): Promise<void> {
  if (!hasSupabase) return;
  const db = createAdminClient();
  await db.from("support_threads").update({ admin_unread: 0 }).eq("id", threadId);
}

/** Every open/recent support thread, newest activity first, with member info. */
export async function adminListThreads(limit = 100): Promise<AdminSupportThread[]> {
  if (!hasSupabase) return [];
  const db = createAdminClient();
  const { data: threads } = await db
    .from("support_threads")
    .select("id, user_id, status, last_message, last_message_at, last_sender, admin_unread")
    .order("last_message_at", { ascending: false })
    .limit(limit);
  const rows = (threads ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];
  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: profs } = await db
    .from("profiles")
    .select("id, handle, display_name, avatar_url, email")
    .in("id", userIds);
  const byId = new Map((profs ?? []).map((p) => [p.id as string, p as Record<string, unknown>]));
  return rows.map((r) => {
    const p = byId.get(r.user_id as string);
    return {
      id: r.id as string,
      userId: r.user_id as string,
      handle: (p?.handle as string) ?? null,
      displayName: (p?.display_name as string) ?? null,
      avatarUrl: (p?.avatar_url as string) ?? null,
      email: (p?.email as string) ?? null,
      lastMessage: (r.last_message as string) ?? null,
      lastMessageAt: r.last_message_at as string,
      lastSender: (r.last_sender as SupportRole) ?? null,
      adminUnread: (r.admin_unread as number) ?? 0,
      status: ((r.status as string) ?? "open") as "open" | "closed",
    };
  });
}

/** A single thread's messages, for the admin reader. */
export async function adminGetMessages(threadId: string): Promise<SupportMessage[]> {
  if (!hasSupabase) return [];
  const db = createAdminClient();
  const { data: rows } = await db
    .from("support_messages")
    .select("id, sender_role, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(500);
  return mapMessages(rows);
}

/** User ids that should receive an admin support alert: anyone with the admin
 *  role, plus anyone whose email is in ADMIN_EMAILS. */
export async function resolveAdminUserIds(): Promise<string[]> {
  const db = createAdminClient();
  const ids = new Set<string>();
  const { data: byRole } = await db.from("profiles").select("id").eq("role", "admin");
  for (const r of byRole ?? []) ids.add(r.id as string);
  const emails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length > 0) {
    const { data: byEmail } = await db.from("profiles").select("id, email").in("email", emails);
    for (const r of byEmail ?? []) ids.add(r.id as string);
  }
  return [...ids];
}

async function notifyAdminsOfMessage(fromUserId: string, body: string): Promise<void> {
  const db = createAdminClient();
  const { data: sender } = await db
    .from("profiles")
    .select("handle, display_name")
    .eq("id", fromUserId)
    .maybeSingle();
  const name =
    (sender?.display_name as string) ||
    (sender?.handle ? `@${sender.handle as string}` : "A member");
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;

  // Push to every admin — 'critical' so it isn't held back by an admin's own DND.
  const adminIds = await resolveAdminUserIds();
  await Promise.all(
    adminIds.map((id) =>
      sendSmartPush(
        id,
        { title: `Support · ${name}`, body: preview, url: `${SITE_URL}/admin`, tag: "support" },
        "critical",
        "system",
        { type: "system" },
      ).catch(() => {}),
    ),
  );

  // Email the admin inbox (ALERT_EMAIL_TO / ADMIN_EMAILS).
  await sendAdminEmail(
    `New support message from ${name}`,
    alertEmailHtml({
      heading: "New support message",
      intro: `${escapeHtml(name)} sent a message in Support. Reply from the admin dashboard's Support inbox.`,
      rows: [{ label: "Message", value: escapeHtml(preview) }],
      footnote: "FrenzSave · Support",
    }),
  );
}

async function notifyMemberOfReply(memberId: string, body: string): Promise<void> {
  const db = createAdminClient();
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;

  await sendSmartPush(
    memberId,
    { title: "Support replied", body: preview, url: `${SITE_URL}/support`, tag: "support-reply" },
    "high",
    "system",
    { type: "system" },
  ).catch(() => {});

  const { data: prof } = await db
    .from("profiles")
    .select("email")
    .eq("id", memberId)
    .maybeSingle();
  const email = prof?.email as string | undefined;
  if (email) {
    await sendProductEmail(email, {
      subject: "The FrenzSave team replied to your message",
      heading: "We replied to your support message",
      intro: "Our team just answered you in Support. Open the chat to read the full reply and continue the conversation.",
      body: escapeHtml(preview),
      ctaLabel: "Open Support",
      ctaHref: `${SITE_URL}/support`,
    });
  }
}
