-- Replies to replies: a comment may point at a parent comment on the same post.
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS comments_post_parent_idx ON public.comments (post_id, parent_id, created_at);
