create or replace function public.notify_workspace_invite()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare wname text; target uuid;
begin
  if new.status <> 'invited' then return new; end if;
  select p.id into target from public.profiles p
    join auth.users u on u.id = p.auth_user_id
   where lower(u.email) = lower(new.email) limit 1;
  if target is null then return new; end if;
  select name into wname from public.workspaces where id = new.workspace_id;
  insert into public.notifications (recipient_id, actor_id, type, body, entity_type, entity_id)
  values (target, new.invited_by, 'workspace_invite',
          'You were invited to join ' || coalesce(wname,'a workspace'),
          'workspace_member', new.id);
  return new;
end $$;
revoke execute on function public.notify_workspace_invite() from anon, authenticated, public;