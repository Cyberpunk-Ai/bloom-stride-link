-- Phase 6: server-side "for you" scoring with keyset pagination.
--
-- Moves ranking out of JS (which pulled ~300 rows per request) into a single
-- indexed SQL query. Weights are tunable per-call so the app can source
-- defaults from env (RECS_W_RECENCY, RECS_W_ENGAGEMENT, RECS_W_AFFINITY,
-- RECS_W_FOLLOW, RECS_HALFLIFE_HOURS, RECS_AUTHOR_CAP) without a redeploy of
-- this function. When p_user_id has no follows/affinity/history the query
-- degenerates naturally into a quality+recency ranking across diverse
-- authors, which serves as the cold-start path.
--
-- Indexes assumed/added below support: recent visible posts, per-viewer
-- exclusions (impressions/not-interested), and block/mute lookups.

create index if not exists posts_hidden_created_idx
  on public.posts (created_at desc) where hidden = false;

create index if not exists post_impressions_user_post_idx
  on public.post_impressions (user_id, post_id);

create or replace function public.get_for_you_feed(
  p_user_id uuid,
  p_limit integer default 20,
  p_cursor_score double precision default null,
  p_cursor_id uuid default null,
  p_w_recency double precision default 1.0,
  p_w_engagement double precision default 1.0,
  p_w_affinity double precision default 1.0,
  p_w_follow double precision default 1.0,
  p_halflife_hours double precision default 30,
  p_author_cap integer default 2,
  p_candidate_pool integer default 600
)
returns table (post_id uuid, score double precision)
language sql
stable
security definer
set search_path = public
as $$
  with excluded_posts as (
    select post_id from public.post_impressions where p_user_id is not null and user_id = p_user_id
    union
    select post_id from public.post_not_interested where p_user_id is not null and user_id = p_user_id and post_id is not null
  ),
  excluded_authors as (
    select author_id from public.post_not_interested where p_user_id is not null and user_id = p_user_id and author_id is not null
    union
    select blocked_id as author_id from public.user_blocks where p_user_id is not null and blocker_id = p_user_id
    union
    select blocker_id as author_id from public.user_blocks where p_user_id is not null and blocked_id = p_user_id
    union
    select muted_id as author_id from public.user_mutes where p_user_id is not null and muter_id = p_user_id
  ),
  followed as (
    select target_id from public.follows where p_user_id is not null and follower_id = p_user_id
  ),
  affinity as (
    select author_id, score from public.author_affinity where p_user_id is not null and user_id = p_user_id
  ),
  candidates as (
    select p.*
    from public.posts p
    where p.hidden = false
      and not exists (select 1 from excluded_posts e where e.post_id = p.id)
      and not exists (select 1 from excluded_authors e where e.author_id = p.user_id)
    order by p.created_at desc
    limit greatest(p_candidate_pool, p_limit * 10)
  ),
  scored as (
    select
      c.id as post_id,
      c.user_id as author_id,
      (
        p_w_recency * exp(
          - ln(2) * (extract(epoch from (now() - c.created_at)) / 3600.0)
            / greatest(p_halflife_hours, 1)
        )
        + p_w_engagement * (
            (coalesce(c.like_count,0) * 3 + coalesce(c.comment_count,0) * 4 + coalesce(c.repost_count,0) * 5)::double precision
            / sqrt(greatest(coalesce(c.view_count,0), 1))
          )
        + p_w_follow * (case when f.target_id is not null then 1 else 0 end)
        + p_w_affinity * coalesce(a.score, 0)
      ) as score
    from candidates c
    left join followed f on f.target_id = c.user_id
    left join affinity a on a.author_id = c.user_id
  ),
  ranked as (
    select s.*,
      row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank
    from scored s
  )
  select r.post_id, r.score
  from ranked r
  where r.author_rank <= greatest(p_author_cap, 1)
    and (
      p_cursor_score is null
      or r.score < p_cursor_score
      or (r.score = p_cursor_score and r.post_id < p_cursor_id)
    )
  order by r.score desc, r.post_id desc
  limit greatest(p_limit, 1);
$$;

-- Runs as SECURITY DEFINER because it reads other users' post_not_interested /
-- author_affinity rows (RLS-protected) on the caller's behalf; the caller's
-- own profile id must be passed in as p_user_id by a trusted server fn, never
-- taken from client input directly, and RLS on posts already covers hidden
-- rows. No direct table grants are needed beyond this function.
grant execute on function public.get_for_you_feed(
  uuid, integer, double precision, uuid, double precision, double precision,
  double precision, double precision, double precision, integer, integer
) to authenticated;
revoke all on function public.get_for_you_feed(
  uuid, integer, double precision, uuid, double precision, double precision,
  double precision, double precision, double precision, integer, integer
) from anon, public;
