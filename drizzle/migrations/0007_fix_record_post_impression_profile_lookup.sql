create or replace function public.record_post_impression(p_post_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_views integer;
begin
  select id into v_profile from public.profiles where auth_user_id = auth.uid() limit 1;

  if v_profile is not null then
    if not exists (
      select 1 from public.post_impressions
      where post_id = p_post_id and user_id = v_profile
    ) then
      insert into public.post_impressions (post_id, user_id) values (p_post_id, v_profile);
    end if;
  else
    insert into public.post_impressions (post_id, user_id) values (p_post_id, null);
  end if;

  select view_count into v_views from public.posts where id = p_post_id;
  return coalesce(v_views, 0);
end;
$$;