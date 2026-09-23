-- Give notifications a target so tapping one opens the post or profile it refers to.
alter table public.notifications
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

create or replace function public.notify_engagement()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; kind text := tg_argv[0]; actor uuid; label text;
        target_type text; target_id uuid;
begin
  if kind = 'follow' then
    owner_id := new.target_id; actor := new.follower_id;
    target_type := 'profile'; target_id := new.follower_id;
  else
    select user_id into owner_id from public.posts where id = new.post_id;
    actor := new.user_id;
    target_type := 'post'; target_id := new.post_id;
  end if;
  if owner_id is null or owner_id = actor then return new; end if;
  select coalesce(display_name, username) into label from public.profiles where id = actor;
  insert into public.notifications (recipient_id, actor_id, type, body, entity_type, entity_id)
  values (owner_id, actor, kind,
    case kind
      when 'like' then coalesce(label,'Someone') || ' liked your post'
      when 'repost' then coalesce(label,'Someone') || ' reposted your post'
      when 'comment' then coalesce(label,'Someone') || ' commented on your post'
      when 'follow' then coalesce(label,'Someone') || ' started following you'
      else coalesce(label,'Someone') || ' interacted with your post'
    end,
    target_type, target_id);
  return new;
end $$;

create or replace function public.notify_tip()
returns trigger language plpgsql security definer set search_path = public as $$
declare label text;
begin
  select coalesce(display_name, username) into label from public.profiles where id = new.from_user_id;
  insert into public.notifications (recipient_id, actor_id, type, body, entity_type, entity_id)
  values (new.to_user_id, new.from_user_id, 'tip',
          coalesce(label,'Someone') || ' sent you a tip',
          'profile', new.from_user_id);
  return new;
end $$;

create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; label text;
begin
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into recipient from public.conversations c where c.id = new.conversation_id;
  if recipient is null or recipient = new.sender_id then return new; end if;
  select coalesce(display_name, username) into label from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, actor_id, type, body, entity_type, entity_id)
  values (recipient, new.sender_id, 'message',
          coalesce(label,'Someone') || ' sent you a message',
          'conversation', new.conversation_id);
  return new;
end $$;
