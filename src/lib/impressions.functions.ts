/**
 * Batched impression recording (Phase 5). The client dwell-tracks posts and
 * flushes a small batch of ids every few seconds instead of one call per
 * post. Rate limiting and per-viewer de-dupe happen in
 * `record_post_impressions_batch` (pending-sql/0010).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  postIds: z.array(z.string().uuid()).min(1).max(50),
});

export const recordImpressions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: inserted, error } = await supabase.rpc("record_post_impressions_batch", {
      p_post_ids: data.postIds,
    });
    if (error) {
      console.error("recordImpressions failed:", error.message);
      return { inserted: 0 };
    }
    return { inserted: typeof inserted === "number" ? inserted : 0 };
  });
