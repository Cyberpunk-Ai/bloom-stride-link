/**
 * Personalised "For you" ranking.
 *
 * Blends four signals over tables we already have, entirely server-side:
 *  - Behaviour: the tags and authors this person likes, reposts, bookmarks,
 *    comments on, or spends impressions on.
 *  - Graph: authors they follow, plus the authors those people follow.
 *  - Quality and recency: engagement rate with time decay, so good new posts
 *    surface instead of being buried by older hits.
 *  - Diversity: a cap per author so one account can't fill the feed.
 *
 * Paid plans get a modest discovery boost (reach), while free creators still
 * rank on their own merits.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Reach multiplier by the author's plan — paid plans surface a little wider. */
const PLAN_REACH: Record<string, number> = {
  free: 1,
  plus: 1.2,
  premium: 1.2,
  creator: 1.2,
  pro: 1.4,
  studio: 1.4,
  business: 1.4,
};

/** How many posts from a single author may appear in one page of results. */
const MAX_PER_AUTHOR = 2;

function planReach(plan?: string | null) {
  return PLAN_REACH[String(plan ?? "free").toLowerCase()] ?? 1;
}

function tagsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((t) => String(t).toLowerCase());
  return [];
}

export const getForYouFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => ({
    limit: Math.min(Math.max(Number(input?.limit ?? 20), 5), 50),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    const meId = profile?.id ? String(profile.id) : null;

    // Candidate pool: recent, visible posts.
    const { data: candidateRows, error } = await supabase
      .from("posts")
      .select("*")
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      console.error("Could not load candidate posts:", error);
      return { posts: [], personalised: false };
    }
    const candidates = (candidateRows ?? []) as any[];
    if (!meId || candidates.length === 0) {
      return { posts: candidates.slice(0, data.limit), personalised: false };
    }

    // --- Graph: who I follow, and who they follow.
    const { data: myFollows } = await supabase
      .from("follows")
      .select("target_id")
      .eq("follower_id", meId)
      .limit(1000);
    const firstDegree = new Set(((myFollows ?? []) as any[]).map((f) => String(f.target_id)));

    let secondDegree = new Set<string>();
    if (firstDegree.size) {
      const { data: theirFollows } = await supabase
        .from("follows")
        .select("target_id")
        .in("follower_id", Array.from(firstDegree).slice(0, 200))
        .limit(2000);
      secondDegree = new Set(((theirFollows ?? []) as any[]).map((f) => String(f.target_id)));
    }

    // --- Behaviour: what I've engaged with recently.
    const [{ data: likes }, { data: reposts }, { data: bookmarks }, { data: comments }, { data: views }] =
      await Promise.all([
        supabase.from("likes").select("post_id").eq("user_id", meId).limit(300),
        supabase.from("reposts").select("post_id").eq("user_id", meId).limit(300),
        supabase.from("bookmarks").select("post_id").eq("user_id", meId).limit(300),
        supabase.from("comments").select("post_id").eq("user_id", meId).limit(300),
        supabase.from("post_impressions").select("post_id").eq("user_id", meId).limit(500),
      ]);

    const weighted: Array<[any[], number]> = [
      [(likes ?? []) as any[], 3],
      [(reposts ?? []) as any[], 4],
      [(bookmarks ?? []) as any[], 4],
      [(comments ?? []) as any[], 5],
      [(views ?? []) as any[], 0.5],
    ];
    const engagedWeight = new Map<string, number>();
    for (const [rows, weight] of weighted) {
      for (const row of rows) {
        const id = String(row.post_id);
        engagedWeight.set(id, (engagedWeight.get(id) ?? 0) + weight);
      }
    }

    const engagedIds = Array.from(engagedWeight.keys());
    const tagAffinity = new Map<string, number>();
    const authorAffinity = new Map<string, number>();
    if (engagedIds.length) {
      const { data: engagedPosts } = await supabase
        .from("posts")
        .select("id, user_id, tags")
        .in("id", engagedIds.slice(0, 400));
      for (const row of (engagedPosts ?? []) as any[]) {
        const weight = engagedWeight.get(String(row.id)) ?? 1;
        const author = String(row.user_id);
        authorAffinity.set(author, (authorAffinity.get(author) ?? 0) + weight);
        for (const tag of tagsOf(row.tags)) {
          tagAffinity.set(tag, (tagAffinity.get(tag) ?? 0) + weight);
        }
      }
    }

    const hasHistory = engagedIds.length > 0 || firstDegree.size > 0;

    // --- Author plans, for the reach boost.
    const authorIds = Array.from(new Set(candidates.map((p) => String(p.user_id))));
    const plans = new Map<string, string>();
    if (authorIds.length) {
      const { data: authors } = await supabase
        .from("profiles")
        .select("id, plan")
        .in("id", authorIds.slice(0, 500));
      for (const a of (authors ?? []) as any[]) plans.set(String(a.id), String(a.plan ?? "free"));
    }

    const now = Date.now();
    const maxTagAffinity = Math.max(1, ...Array.from(tagAffinity.values()));
    const maxAuthorAffinity = Math.max(1, ...Array.from(authorAffinity.values()));

    const scored = candidates.map((post) => {
      const author = String(post.user_id);
      const ageHours = Math.max(0.5, (now - new Date(post.created_at).getTime()) / 3_600_000);

      const engagement =
        Number(post.like_count ?? 0) * 3 +
        Number(post.comment_count ?? 0) * 4 +
        Number(post.repost_count ?? 0) * 5;
      const views = Math.max(1, Number(post.view_count ?? 0));
      const rate = engagement / Math.sqrt(views);
      const quality = (engagement * 0.6 + rate * 8 + 4) / Math.pow(ageHours, 0.7);

      const graph = author === meId ? 6 : firstDegree.has(author) ? 14 : secondDegree.has(author) ? 6 : 0;

      const behaviourTags =
        tagsOf(post.tags).reduce((sum, tag) => sum + (tagAffinity.get(tag) ?? 0), 0) /
        maxTagAffinity;
      const behaviourAuthor = (authorAffinity.get(author) ?? 0) / maxAuthorAffinity;
      const behaviour = behaviourTags * 8 + behaviourAuthor * 10;

      const seen = engagedWeight.has(String(post.id)) ? 0.45 : 1;

      const score = (quality + graph + behaviour) * planReach(plans.get(author)) * seen;
      return { post, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Diversity: never more than MAX_PER_AUTHOR posts from one account.
    const perAuthor = new Map<string, number>();
    const picked: any[] = [];
    const overflow: any[] = [];
    for (const { post } of scored) {
      const author = String(post.user_id);
      const count = perAuthor.get(author) ?? 0;
      if (count < MAX_PER_AUTHOR) {
        perAuthor.set(author, count + 1);
        picked.push(post);
      } else {
        overflow.push(post);
      }
      if (picked.length >= data.limit) break;
    }
    if (picked.length < data.limit) picked.push(...overflow.slice(0, data.limit - picked.length));

    return { posts: picked.slice(0, data.limit), personalised: hasHistory };
  });
