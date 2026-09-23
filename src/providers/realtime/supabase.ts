import { supabase } from "@/integrations/supabase/client";

import type { RealtimeChangeHandler, RealtimeProvider } from "@/providers/types";

const CHANNEL_NAME = "spaces-app-events";

/**
 * Client-safe realtime provider backed by Supabase Realtime. This wraps the
 * same channel primitives used by `src/lib/realtime.ts` behind the shared
 * `RealtimeProvider` interface so other realtime backends can be swapped in
 * without touching call sites.
 */
export function createSupabaseRealtime(): RealtimeProvider {
  return {
    subscribeChanges(table: string, handler: RealtimeChangeHandler) {
      const channel = supabase
        .channel(`db-${table}`)
        .on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table },
          (payload: unknown) => handler(payload),
        )
        .subscribe();
      return () => {
        void supabase.removeChannel(channel);
      };
    },

    broadcast(event: string, payload: unknown) {
      const channel = supabase.channel(CHANNEL_NAME, { config: { broadcast: { self: false } } });
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.send({ type: "broadcast", event, payload });
        }
      });
    },
  };
}
