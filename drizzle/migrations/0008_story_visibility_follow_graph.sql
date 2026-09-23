-- Stories are visible to the author, to people they follow, to their followers,
-- and to staff — and only while they have not expired.
DROP POLICY IF EXISTS "stories public read" ON public.stories;

CREATE POLICY "stories follow graph read"
ON public.stories
FOR SELECT
TO authenticated
USING (
  public.is_staff()
  OR public.owns_profile(user_id)
  OR (
    expires_at > now()
    AND (
      EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = public.current_profile_id()
          AND f.target_id = stories.user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = stories.user_id
          AND f.target_id = public.current_profile_id()
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS follows_follower_target_idx ON public.follows (follower_id, target_id);
CREATE INDEX IF NOT EXISTS follows_target_follower_idx ON public.follows (target_id, follower_id);
CREATE INDEX IF NOT EXISTS stories_expires_at_idx ON public.stories (expires_at DESC);
