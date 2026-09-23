/**
 * Client-side impression batching (Phase 5).
 *
 * Posts are queued after a short dwell (handled by the caller, e.g.
 * PostCard's IntersectionObserver) and flushed together every few seconds,
 * on tab hide, and on page hide — instead of firing one network call per
 * post as it scrolls into view.
 */
import { recordImpressions } from "@/lib/impressions.functions";

const FLUSH_INTERVAL_MS = 4000;
const MAX_BATCH = 50;

const queued = new Set<string>();
const sent = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function isUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Adds a post id to the pending batch (deduped per session) and schedules a flush. */
export function queueImpression(postId: string) {
  if (!postId || !isUuid(postId)) return;
  if (sent.has(postId) || queued.has(postId)) return;
  queued.add(postId);
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer || flushing) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushImpressions();
  }, FLUSH_INTERVAL_MS);
}

/** Sends the queued batch now (used by the timer, visibility changes, and page hide). */
export async function flushImpressions() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queued.size === 0 || flushing) return;
  flushing = true;
  const ids = Array.from(queued).slice(0, MAX_BATCH);
  for (const id of ids) {
    queued.delete(id);
    sent.add(id);
  }
  try {
    await recordImpressions({ data: { postIds: ids } });
  } catch {
    // Allow a retry on the next flush instead of silently losing the view.
    for (const id of ids) sent.delete(id);
  } finally {
    flushing = false;
    if (queued.size > 0) scheduleFlush();
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushImpressions();
  });
  window.addEventListener("pagehide", () => {
    void flushImpressions();
  });
}
