/**
 * Incremental author-affinity updates (Phase 6). Called when a viewer likes,
 * comments, reposts, or dwells on a post, so `get_for_you_feed` can read a
 * fresh score without recomputing it from raw engagement tables.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SIGNAL_WEIGHT: Record<string, number> = {
  dwell: 0.5,
  like: 3,
  comment: 5,
  repost: 4,
  bookmark: 4,
};

const inputSchema = z.object({
  authorId: z.string().uuid(),
  signal: z.enum(["dwell", "like", "comment", "repost", "bookmark"]),
});

export const bumpAuthorAffinity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", userId)
      .maybeSingle();
    const meId = profile?.id ? String(profile.id) : null;
    if (!meId) return { ok: false };

    const delta = SIGNAL_WEIGHT[data.signal] ?? 1;
    const { error } = await supabase.rpc("bump_author_affinity", {
      p_user_id: meId,
      p_author_id: data.authorId,
      p_delta: delta,
    });
    if (error) {
      console.error("bumpAuthorAffinity failed:", error.message);
      return { ok: false };
    }
    return { ok: true };
  });
