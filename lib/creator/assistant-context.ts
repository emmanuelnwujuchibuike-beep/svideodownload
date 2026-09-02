import "server-only";

import { categoryLabel } from "@/lib/social/categories";
import { getCreatorAnalytics } from "@/lib/social/creator-analytics";
import { getCreatorLounge } from "@/lib/social/creator-lounge";
import { listTrendingSounds } from "@/lib/social/sounds";
import { createAdminClient } from "@/lib/supabase/admin";

import { getAudienceInsights } from "./audience";
import { rankTagPerformance } from "./hashtag-performance";

/**
 * Creator Assistant grounding data (Feature 15 · Part 9).
 *
 * ── Named "Creator Assistant", not "AI Creator Assistant" ────────────────
 * Standing naming rule on this project: "Smart, never AI". Same reason Part 8
 * shipped a "Smart Discovery Assistant".
 *
 * ── Every line is a measured fact ───────────────────────────────────────
 * This builds the `context` string that /api/assistant appends to its system
 * prompt as clearly-labeled DATA the model may cite and must not exceed. That
 * contract only holds if what goes in is true, so every line below is a real
 * count, a real average or a real timestamp read out of this creator's own
 * rows. Nothing is modeled, projected or rounded into a claim.
 *
 * Where a fact is unavailable, the line says so explicitly rather than being
 * omitted — "no watch data yet" stops the model from filling the silence with
 * a plausible number, which an absent line would invite.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Matches the assistant route's own cap on `context`. */
const MAX_CONTEXT = 2000;

function hourLabel(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

export async function buildCreatorContext(userId: string, utcOffsetMinutes = 0): Promise<string> {
  if (!hasSupabase) return "";

  try {
    const db = createAdminClient();

    const [analytics, lounge, audience, sounds, postRows] = await Promise.all([
      getCreatorAnalytics(userId),
      getCreatorLounge(userId, 40),
      getAudienceInsights(userId, utcOffsetMinutes),
      listTrendingSounds({ limit: 3 }),
      db
        .from("posts")
        .select("id, title, description, category, created_at, views_count, likes_count, comments_count, shares_count, saves_count, completion_rate")
        .eq("publisher_id", userId)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(300)
        .then((r) => (r.data ?? []) as PostRow[], () => [] as PostRow[]),
    ]);

    const lines: string[] = [];

    lines.push(
      `This creator has ${analytics.totals.posts} published posts, ${analytics.followers} followers, ` +
        `${analytics.totals.views} total views and an engagement rate of ${analytics.engagementRate}%.`,
    );

    if (analytics.discovery.retention > 0) {
      lines.push(`Their average watch-through is ${analytics.discovery.retention}%.`);
    } else {
      lines.push("No watch-depth data has been recorded for them yet — do not estimate a watch-through figure.");
    }

    // Best posting hour — the single most actionable fact available, and the
    // reason the audience histogram exists at all.
    if (audience.peakHour !== null) {
      const watches = audience.viewingHours[audience.peakHour] ?? 0;
      lines.push(
        `Their audience watches most around ${hourLabel(audience.peakHour)} in the creator's own local time ` +
          `(${watches} watches in that hour over the last 90 days).`,
      );
    } else {
      lines.push("There is not enough watch history to identify when their audience is most active.");
    }

    // Category performance, averaged per post so a prolific category cannot win
    // on volume alone.
    const byCategory = new Map<string, { views: number; posts: number }>();
    for (const p of postRows) {
      const key = p.category ?? "other";
      const prev = byCategory.get(key) ?? { views: 0, posts: 0 };
      byCategory.set(key, { views: prev.views + (p.views_count ?? 0), posts: prev.posts + 1 });
    }
    const ranked = [...byCategory.entries()]
      .filter(([, v]) => v.posts >= 2)
      .map(([category, v]) => ({ category, avg: Math.round(v.views / v.posts), posts: v.posts }))
      .sort((a, b) => b.avg - a.avg);

    if (ranked.length > 0) {
      lines.push(
        `Category performance, average views per post: ${ranked
          .slice(0, 5)
          .map((r) => `${categoryLabel(r.category)} ${r.avg} (${r.posts} posts)`)
          .join(", ")}.`,
      );
    }

    const tags = rankTagPerformance(
      postRows.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        views: p.views_count ?? 0,
        engagement: (p.likes_count ?? 0) + (p.comments_count ?? 0) + (p.shares_count ?? 0) + (p.saves_count ?? 0),
      })),
    ).filter((t) => t.posts >= 2);

    if (tags.length > 0) {
      lines.push(
        `Their best-performing hashtags by average views: ${tags
          .slice(0, 5)
          .map((t) => `#${t.display} (${Math.round(t.averageViews)} avg over ${t.posts} posts)`)
          .join(", ")}.`,
      );
    } else {
      lines.push("They have no hashtag with enough posts to compare yet.");
    }

    // Upload rhythm — weeks active out of the last eight.
    const now = Date.now();
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const end = now - i * 7 * 864e5;
      const start = end - 7 * 864e5;
      return postRows.filter((p) => {
        const t = new Date(p.created_at).getTime();
        return t >= start && t < end;
      }).length;
    });
    lines.push(
      `Upload rhythm: they published in ${weeks.filter((n) => n > 0).length} of the last 8 weeks ` +
        `(${weeks.join(", ")} posts per week, most recent week first).`,
    );

    if (lounge.unanswered.length > 0) {
      lines.push(`They have ${lounge.unanswered.length} unanswered questions on their posts.`);
    }
    lines.push(`They have replied to ${lounge.replyRatePercent}% of comments they received.`);

    if (analytics.discovery.trafficSources.length > 0) {
      lines.push(
        `Where their views come from: ${analytics.discovery.trafficSources
          .slice(0, 4)
          .map((s) => `${s.source} ${s.count}`)
          .join(", ")}.`,
      );
    }

    if (sounds.length > 0) {
      lines.push(
        `Currently trending sounds on the platform: ${sounds.map((s) => `"${s.title}" by ${s.artistLabel}`).join("; ")}.`,
      );
    }

    lines.push(
      "Facts NOT available for this creator, which must never be estimated or invented: " +
        "audience age, country, city, language or device; revenue or earnings of any kind; " +
        "community membership; and how any individual viewer behaved.",
    );

    return lines.join("\n").slice(0, MAX_CONTEXT);
  } catch {
    return "";
  }
}

interface PostRow {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  created_at: string;
  views_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  saves_count: number | null;
  completion_rate: number | null;
}
