-- Phase 6: incremental author-affinity updates.
--
-- Called when a viewer likes/comments/reposts/dwells on a post so the
-- "for you" ranking function (0012) can read a fresh score without
-- recomputing it from raw engagement tables on every feed request.
create or replace function public.bump_author_affinity(
  p_user_id uuid,
  p_author_id uuid,
  p_delta double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_author_id is null or p_user_id = p_author_id then
    return;
  end if;

  insert into public.author_affinity (user_id, author_id, score, interactions, updated_at)
  values (p_user_id, p_author_id, p_delta, 1, now())
  on conflict (user_id, author_id) do update
    set score = public.author_affinity.score + excluded.score,
        interactions = public.author_affinity.interactions + 1,
        updated_at = now();
end;
$$;

-- RLS on author_affinity only grants owners select; writes go through this
-- SECURITY DEFINER function, invoked from a server fn that already
-- authenticates the caller and passes their own profile id as p_user_id.
grant execute on function public.bump_author_affinity(uuid, uuid, double precision) to authenticated;
revoke all on function public.bump_author_affinity(uuid, uuid, double precision) from anon, public;
