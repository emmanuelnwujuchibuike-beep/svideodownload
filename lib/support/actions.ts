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
  type AdminSupportThread,
  type MySupportThread,
  type SupportMessage,
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

/** Admin: every support thread, newest first. */
export async function adminLoadThreads(): Promise<AdminSupportThread[]> {
  const admin = await getAdminUser();
  if (!admin) return [];
  return adminListThreads();
}

/** Admin: a thread's messages (marks it read on open). */
export async function adminLoadMessages(threadId: string): Promise<SupportMessage[]> {
  const admin = await getAdminUser();
  if (!admin) return [];
  await markThreadReadByAdmin(threadId);
  return adminGetMessages(threadId);
}

/** Admin: delete a finished support thread and its messages. */
export async function adminClearThread(threadId: string): Promise<{ ok: boolean }> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false };
  await deleteThreadById(threadId);
  return { ok: true };
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
