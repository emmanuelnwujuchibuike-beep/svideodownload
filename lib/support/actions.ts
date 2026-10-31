"use server";

import { getAdminUser } from "@/lib/admin/guard";
import {
  adminGetMessages,
  adminListThreads,
  cleanBody,
  clearThreadForUser,
  deleteThreadById,
  getMyThread,
  markMyThreadRead,
  markThreadReadByAdmin,
  postAdminReply,
  postUserMessage,
  searchSupportRecipients,
  startSupportEmail,
  type AdminSupportThread,
  type MySupportThread,
  type StartSupportEmailResult,
  type SupportMessage,
  type SupportRecipient,
} from "@/lib/support/chat";
import { createClient } from "@/lib/supabase/server";

/**
 * Client-callable server actions for Support Chat. The member-facing actions
 * identify the caller with getUser(); the admin-facing ones gate on getAdminUser()
 * and refuse silently for anyone else. Reads are polled by the chat UIs, so they
 * return the current snapshot each call.
 */

export type MyThreadResult =
  | { signedIn: false }
  | { signedIn: true; thread: MySupportThread | null };

/** The member's thread (marks admin replies read on open). */
export async function loadMyThread(): Promise<MyThreadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false };
  await markMyThreadRead(user.id);
  const thread = await getMyThread(user.id);
  return { signedIn: true, thread };
}

/** Member sends a support message. */
export async function sendMyMessage(
  body: string,
): Promise<{ ok: true; message: SupportMessage } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in to chat with our team." };
  const clean = cleanBody(body);
  if (!clean) return { ok: false, error: "Type a message first." };
  const message = await postUserMessage(user.id, clean);
  if (!message) return { ok: false, error: "Couldn't send that — please try again." };
  return { ok: true, message };
}

/** Member clears their own finished conversation. */
export async function clearMyThread(): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  await clearThreadForUser(user.id);
  return { ok: true };
}

/*
  🔴 A LOCKED DASHBOARD SAYS SO (owner, 2026-10-31: "why can't I see new support message in admin support?"). The admin
  lock (lib/admin/lock.ts, 0301) lasts 8 hours; after that getAdminUser() is null and these answered an empty list —
  a dashboard left open showed no new messages and no reason. They now answer `locked`, and the inbox shows it with a
  way back in. Still nothing is read for a locked or non-admin caller.
*/
export type AdminRead<T> = { locked: false; data: T } | { locked: true };

/** Admin: every support thread, newest first. */
export async function adminLoadThreads(): Promise<AdminRead<AdminSupportThread[]>> {
  const admin = await getAdminUser();
  if (!admin) return { locked: true };
  return { locked: false, data: await adminListThreads() };
}

/** Admin: a thread's messages (marks it read on open). */
export async function adminLoadMessages(threadId: string): Promise<AdminRead<SupportMessage[]>> {
  const admin = await getAdminUser();
  if (!admin) return { locked: true };
  await markThreadReadByAdmin(threadId);
  return { locked: false, data: await adminGetMessages(threadId) };
}

/** Admin: delete a finished support thread and its messages. */
export async function adminClearThread(threadId: string): Promise<{ ok: boolean }> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false };
  await deleteThreadById(threadId);
  return { ok: true };
}

/** Admin: members matching a handle, name or email — the "New email" picker. */
export async function adminFindRecipients(query: string): Promise<SupportRecipient[]> {
  const admin = await getAdminUser();
  if (!admin) return [];
  return searchSupportRecipients(String(query ?? ""));
}

/** Admin: email a member (or any address) from support@frenzsave.com — they never had to write first. */
export async function adminStartSupportEmail(input: { userId?: string | null; email?: string | null; subject: string; body: string }): Promise<StartSupportEmailResult> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, error: "Not authorised." };
  return startSupportEmail(admin.id, {
    userId: typeof input?.userId === "string" ? input.userId : null,
    email: typeof input?.email === "string" ? input.email : null,
    subject: String(input?.subject ?? ""),
    body: String(input?.body ?? ""),
  });
}

/** Admin: reply to a thread. */
export async function adminSendReply(
  threadId: string,
  body: string,
): Promise<{ ok: true; message: SupportMessage } | { ok: false; error: string }> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, error: "Not authorised." };
  const clean = cleanBody(body);
  if (!clean) return { ok: false, error: "Type a reply first." };
  const message = await postAdminReply(admin.id, threadId, clean);
  if (!message) return { ok: false, error: "Couldn't send — please try again." };
  return { ok: true, message };
}
