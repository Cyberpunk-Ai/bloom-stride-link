create index if not exists post_impressions_user_created_idx on public.post_impressions (user_id, created_at desc);

create or replace function public.record_post_impressions_batch(p_post_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_profile uuid; v_recent_count integer; v_limit constant integer := 400;
  v_remaining integer; v_inserted integer := 0; v_ids uuid[]; v_len integer;
begin
  if p_post_ids is null then return 0; end if;
  v_len := array_length(p_post_ids, 1);
  if v_len is null or v_len = 0 then return 0; end if;
  if v_len > 50 then p_post_ids := p_post_ids[1:50]; v_len := 50; end if;
  select id into v_profile from public.profiles where auth_user_id = auth.uid() limit 1;
  if v_profile is null then return 0; end if;
  select count(*) into v_recent_count from public.post_impressions
   where user_id = v_profile and created_at > now() - interval '1 minute';
  v_remaining := greatest(0, v_limit - v_recent_count);
  if v_remaining = 0 then return 0; end if;
  v_ids := p_post_ids[1:least(v_len, v_remaining)];
  insert into public.post_impressions (post_id, user_id)
  select pid, v_profile from unnest(v_ids) as pid
  on conflict (post_id, user_id) where user_id is not null do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end; $$;
grant execute on function public.record_post_impressions_batch(uuid[]) to authenticated;
revoke all on function public.record_post_impressions_batch(uuid[]) from anon, public;

create or replace function public.bump_author_affinity(p_user_id uuid, p_author_id uuid, p_delta double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null or p_author_id is null or p_user_id = p_author_id
     or p_user_id is distinct from public.current_profile_id() then return; end if;
  insert into public.author_affinity (user_id, author_id, score, interactions, updated_at)
  values (p_user_id, p_author_id, greatest(least(p_delta, 5), -5), 1, now())
  on conflict (user_id, author_id) do update
    set score = public.author_affinity.score + excluded.score,
        interactions = public.author_affinity.interactions + 1,
        updated_at = now();
end; $$;
grant execute on function public.bump_author_affinity(uuid, uuid, double precision) to authenticated;
revoke all on function public.bump_author_affinity(uuid, uuid, double precision) from anon, public;

create index if not exists posts_hidden_created_idx on public.posts (created_at desc) where hidden = false;
create index if not exists post_impressions_user_post_idx on public.post_impressions (user_id, post_id);

create or replace function public.get_for_you_feed(
  p_user_id uuid, p_limit integer default 20, p_cursor_score double precision default null,
  p_cursor_id uuid default null, p_w_recency double precision default 1.0,
  p_w_engagement double precision default 1.0, p_w_affinity double precision default 1.0,
  p_w_follow double precision default 1.0, p_halflife_hours double precision default 30,
  p_author_cap integer default 2, p_candidate_pool integer default 600)
returns table (post_id uuid, score double precision)
language sql stable security definer set search_path = public as $$
  with excluded_posts as (
    select post_id from public.post_not_interested where p_user_id is not null and user_id = p_user_id and post_id is not null
  ),
  seen as (
    select post_id from public.post_impressions where p_user_id is not null and user_id = p_user_id
  ),
  excluded_authors as (
    select author_id from public.post_not_interested where p_user_id is not null and user_id = p_user_id and author_id is not null
    union select blocked_id from public.user_blocks where p_user_id is not null and blocker_id = p_user_id
    union select blocker_id from public.user_blocks where p_user_id is not null and blocked_id = p_user_id
    union select muted_id from public.user_mutes where p_user_id is not null and muter_id = p_user_id
  ),
  followed as (select target_id from public.follows where p_user_id is not null and follower_id = p_user_id),
  affinity as (select author_id, score from public.author_affinity where p_user_id is not null and user_id = p_user_id),
  candidates as (
    select p.* from public.posts p
    where p.hidden = false
      and (p_user_id is null or p_user_id = public.current_profile_id())
      and not exists (select 1 from excluded_posts e where e.post_id = p.id)
      and not exists (select 1 from excluded_authors e where e.author_id = p.user_id)
    order by p.created_at desc
    limit greatest(p_candidate_pool, p_limit * 10)
  ),
  scored as (
    select c.id as post_id, c.user_id as author_id,
      ( p_w_recency * exp(- ln(2) * (extract(epoch from (now() - c.created_at)) / 3600.0) / greatest(p_halflife_hours, 1))
        + p_w_engagement * ((coalesce(c.like_count,0) * 3 + coalesce(c.comment_count,0) * 4 + coalesce(c.repost_count,0) * 5)::double precision
            / sqrt(greatest(coalesce(c.view_count,0), 1)))
        + p_w_follow * (case when f.target_id is not null then 1 else 0 end)
        + p_w_affinity * coalesce(a.score, 0)
      ) * (case when exists (select 1 from seen s where s.post_id = c.id) then 0.35 else 1 end) as score
    from candidates c
    left join followed f on f.target_id = c.user_id
    left join affinity a on a.author_id = c.user_id
  ),
  ranked as (
    select s.*, row_number() over (partition by s.author_id order by s.score desc, s.post_id desc) as author_rank
    from scored s
  )
  select r.post_id, r.score from ranked r
  where r.author_rank <= greatest(p_author_cap, 1)
    and (p_cursor_score is null or r.score < p_cursor_score or (r.score = p_cursor_score and r.post_id < p_cursor_id))
  order by r.score desc, r.post_id desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.get_for_you_feed(uuid, integer, double precision, uuid, double precision, double precision, double precision, double precision, double precision, integer, integer) to authenticated;
revoke all on function public.get_for_you_feed(uuid, integer, double precision, uuid, double precision, double precision, double precision, double precision, double precision, integer, integer) from anon, public;