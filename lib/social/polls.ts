import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Post polls ("votes"). A creator attaches one poll to their post; members cast
 * a single choice and decide whether that choice is PUBLIC (their avatar shows on
 * the option and they can drop it in the comments) or PRIVATE (counted only).
 * All reads degrade to `null` if the poll tables haven't been migrated yet.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface PollVoterCard {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PollOptionView {
  id: string;
  label: string;
  votesCount: number;
  /** A few public voters (avatars) who picked this option. */
  publicVoters: PollVoterCard[];
}

export interface PollView {
  id: string;
  postId: string;
  question: string;
  allowMultiple: boolean;
  closesAt: string | null;
  closed: boolean;
  totalVotes: number;
  options: PollOptionView[];
  isOwner: boolean;
  viewerVote: { optionId: string; isPublic: boolean } | null;
}

export async function getPoll(postId: string, viewerId: string | null): Promise<PollView | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data: poll, error } = await db
      .from("post_polls")
      .select("id, owner_id, question, allow_multiple, closes_at")
      .eq("post_id", postId)
      .maybeSingle();
    if (error || !poll) return null;
    const pollId = poll.id as string;

    const [{ data: opts }, { data: mine }, { data: pubVotes }] = await Promise.all([
      db.from("poll_options").select("id, label, votes_count, position").eq("poll_id", pollId).order("position", { ascending: true }),
      viewerId
        ? db.from("poll_votes").select("option_id, is_public").eq("poll_id", pollId).eq("user_id", viewerId).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("poll_votes").select("option_id, user_id").eq("poll_id", pollId).eq("is_public", true).limit(120),
    ]);

    const options = (opts ?? []) as { id: string; label: string; votes_count: number }[];

    // Resolve public voters → avatars, grouped per option (cap for the UI).
    const voterRows = (pubVotes ?? []) as { option_id: string; user_id: string }[];
    const cardById = new Map<string, PollVoterCard>();
    if (voterRows.length) {
      const ids = [...new Set(voterRows.map((v) => v.user_id))];
      const { data: profs } = await db
        .from("profiles")
        .select("id, handle, display_name, avatar_url")
        .in("id", ids);
      for (const p of (profs ?? []) as Record<string, unknown>[]) {
        if (!p.handle) continue;
        cardById.set(p.id as string, {
          handle: p.handle as string,
          displayName: (p.display_name as string) || `@${p.handle as string}`,
          avatarUrl: (p.avatar_url as string) ?? null,
        });
      }
    }
    const votersByOption = new Map<string, PollVoterCard[]>();
    for (const v of voterRows) {
      const card = cardById.get(v.user_id);
      if (!card) continue;
      const list = votersByOption.get(v.option_id) ?? [];
      if (list.length < 8) list.push(card);
      votersByOption.set(v.option_id, list);
    }

    const totalVotes = options.reduce((n, o) => n + (o.votes_count || 0), 0);
    const closesAt = (poll.closes_at as string | null) ?? null;
    const closed = !!closesAt && new Date(closesAt).getTime() < Date.now();

    return {
      id: pollId,
      postId,
      question: (poll.question as string) || "",
      allowMultiple: !!poll.allow_multiple,
      closesAt,
      closed,
      totalVotes,
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        votesCount: o.votes_count || 0,
        publicVoters: votersByOption.get(o.id) ?? [],
      })),
      isOwner: viewerId === (poll.owner_id as string),
      viewerVote: mine ? { optionId: (mine as { option_id: string }).option_id, isPublic: !!(mine as { is_public: boolean }).is_public } : null,
    };
  } catch {
    return null;
  }
}
