-- Phase 5: batched, rate-limited impression recording.
--
-- Replaces one-RPC-per-post with a single call that inserts up to 50 rows
-- per invocation and caps how many impressions a single profile can log
-- per rolling minute, so a compromised/looping client can't inflate
-- view_count. The unique index on post_impressions(post_id, user_id)
-- (added in 0004) makes the insert idempotent per viewer/post.

create index if not exists post_impressions_user_created_idx
  on public.post_impressions (user_id, created_at desc);

create or replace function public.record_post_impressions_batch(p_post_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_recent_count integer;
  v_limit constant integer := 400; -- generous per-minute cap per viewer
  v_remaining integer;
  v_inserted integer := 0;
  v_ids uuid[];
  v_len integer;
begin
  if p_post_ids is null then
    return 0;
  end if;

  v_len := array_length(p_post_ids, 1);
  if v_len is null or v_len = 0 then
    return 0;
  end if;

  -- Hard cap the batch itself regardless of what the client claims.
  if v_len > 50 then
    p_post_ids := p_post_ids[1:50];
    v_len := 50;
  end if;

  select id into v_profile from public.profiles where auth_user_id = auth.uid() limit 1;

  if v_profile is null then
    -- Anonymous viewers: best-effort, unattributed impressions, no rate state to key on.
    insert into public.post_impressions (post_id, user_id)
    select pid, null from unnest(p_post_ids) as pid
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    return v_inserted;
  end if;

  select count(*) into v_recent_count
  from public.post_impressions
  where user_id = v_profile
    and created_at > now() - interval '1 minute';

  v_remaining := greatest(0, v_limit - v_recent_count);
  if v_remaining = 0 then
    return 0;
  end if;

  v_ids := p_post_ids[1:least(v_len, v_remaining)];

  insert into public.post_impressions (post_id, user_id)
  select pid, v_profile from unnest(v_ids) as pid
  on conflict (post_id, user_id) where user_id is not null do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Signed-in users only; anon impressions still flow through record_post_impression.
grant execute on function public.record_post_impressions_batch(uuid[]) to authenticated;
revoke all on function public.record_post_impressions_batch(uuid[]) from anon, public;
