import "server-only";

import { usd } from "@/lib/creator/membership/engine";
import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { categoryForType } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Someone subscribed" — push and email to the creator (owner, 2026-10-11: "let
 * users get push and email notification when someone subscribe to their content
 * or profile").
 *
 * ── Once ────────────────────────────────────────────────────────────────────
 * A paid subscription is settled by the webhook AND the return page, in either
 * order. Only the call that actually settled it (the SQL answers the other with
 * `duplicate`) calls this, so the creator hears about one payment once. The
 * in-app row is written by `settle_sub_purchase` in the same transaction as the
 * money, so here the push is sent "already-recorded".
 *
 * ── Never on the money path ─────────────────────────────────────────────────
 * Callers run this in `after()`. A push or an email provider that fails only
 * logs; it can never undo a settled payment or make Paystack redeliver.
 *
 * Push follows the creator's notification settings (category "social"). The
 * email names the subscriber by public display name only.
 */

type Row = Record<string, unknown>;

async function who(id: string): Promise<{ id: string; name: string; handle: string | null; avatarUrl: string | null }> {
  const { data } = await createAdminClient().from("profiles").select("display_name, handle, avatar_url").eq("id", id).maybeSingle();
  const r = data as Row | null;
  const handle = (r?.handle as string | null) ?? null;
  const avatar = (r?.avatar_url as string | null) ?? null;
  return {
    id,
    name: ((r?.display_name as string | null) || (handle ? `@${handle}` : "Someone")).slice(0, 60),
    handle,
    // only a real https photo travels in a push or an email; anything else falls back to the app icon / an initial
    avatarUrl: avatar && /^https:\/\//.test(avatar) ? avatar : null,
  };
}

/** A paid SUB subscription was just settled. */
export async function notifySubscribed(reference: string): Promise<void> {
  try {
    const { data } = await createAdminClient().from("sub_purchases").select("creator_id, subscriber_id, price_cents, period_days").eq("reference", reference).maybeSingle();
    const p = data as Row | null;
    if (!p) return;
    const creatorId = p.creator_id as string;
    // Part 6 (0251): the creator's own choice; "both" (today's behaviour) when unset or before 0251. The in-app row is always written by settle.
    const { data: pref } = await createAdminClient().from("creator_membership_settings").select("notify_subscribed").eq("creator_id", creatorId).maybeSingle();
    const mode = (pref as Row | null)?.notify_subscribed;
    const wantPush = mode !== "off" && mode !== "email";
    const wantEmail = mode !== "off" && mode !== "push";
    if (!wantPush && !wantEmail) return;
    const sub = await who(p.subscriber_id as string);
    const earned = usd(Number(p.price_cents ?? 0));
    await Promise.allSettled([
      /*
        Owner 2026-10-11: "the push should carry the user avatar, name, title, just like a
        proper high grade social media app". The subscriber is the title and the photo
        (the push icon — Android and desktop show it; iOS web push always shows the app
        icon, a platform rule), the body says what happened and what it earned, and the
        tap opens the subscriber's profile. The in-app row is written by settle_sub_purchase.
      */
      !wantPush ? Promise.resolve() : sendSmartPush(
        creatorId,
        {
          title: sub.name,
          body: `subscribed to your PRIVATE POSTS · You earned ${earned}`,
          genericBody: "You have a new subscriber.",
          url: sub.handle ? `/u/${sub.handle}` : "/members",
          icon: sub.avatarUrl ?? undefined,
          tag: `sub-${reference}`,
          actorId: sub.id,
        },
        "high",
        categoryForType("member_joined"),
        { recorded: { type: "member_joined", actorId: sub.id } },
      ),
      !wantEmail ? Promise.resolve() : emailMember(creatorId, {
        subject: `${sub.name} subscribed to your content`,
        heading: "You have a new subscriber",
        intro: `${sub.name} just subscribed to your PRIVATE POSTS for ${Number(p.period_days ?? 30)} days.`,
        person: { name: sub.name, handle: sub.handle, avatarUrl: sub.avatarUrl },
        body: `You earned ${earned}. It's in your private post balance now, and if auto-withdrawal is on it is on its way to your saved bank account.`,
        ctaLabel: "See your members",
        ctaPath: "/members",
      }),
    ]);
  } catch (e) {
    console.error("[sub/notify] subscribed failed", { reference, error: String(e).slice(0, 160) });
  }
}

/** Someone joined the creator's FREE community (the in-app row is written by joinFree). */
export async function notifyJoinedFree(creatorId: string, memberId: string): Promise<void> {
  try {
    const m = await who(memberId);
    await Promise.allSettled([
      sendSmartPush(
        creatorId,
        { title: m.name, body: "joined your community", genericBody: "You have a new member.", url: m.handle ? `/u/${m.handle}` : "/members", icon: m.avatarUrl ?? undefined, tag: `join-${memberId}`, actorId: m.id },
        "medium",
        categoryForType("member_joined"),
        { recorded: { type: "member_joined", actorId: m.id } },
      ),
      emailMember(creatorId, {
        subject: `${m.name} joined your community`,
        heading: "You have a new member",
        intro: `${m.name} joined your free community on Frenz.`,
        person: { name: m.name, handle: m.handle, avatarUrl: m.avatarUrl },
        ctaLabel: "See your members",
        ctaPath: "/members",
      }),
    ]);
  } catch (e) {
    console.error("[sub/notify] joined failed", { creatorId, error: String(e).slice(0, 160) });
  }
}
