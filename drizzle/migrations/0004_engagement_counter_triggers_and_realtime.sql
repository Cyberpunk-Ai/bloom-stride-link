-- One impression per signed-in viewer per post
create unique index if not exists post_impressions_unique_viewer
  on public.post_impressions (post_id, user_id) where user_id is not null;

-- ---------- post counters ----------
create or replace function public.bump_post_counter()
returns trigger language plpgsql security definer set search_path = public as $$
declare col text := tg_argv[0]; delta int; pid uuid;
begin
  if tg_op = 'INSERT' then delta := 1; else delta := -1; end if;
  pid := coalesce(new.post_id, old.post_id);
  execute format('update public.posts set %I = greatest(0, %I + $1) where id = $2', col, col)
    using delta, pid;
  return coalesce(new, old);
end $$;

drop trigger if exists t_likes_count on public.likes;
create trigger t_likes_count after insert or delete on public.likes
for each row execute function public.bump_post_counter('like_count');

drop trigger if exists t_reposts_count on public.reposts;
create trigger t_reposts_count after insert or delete on public.reposts
for each row execute function public.bump_post_counter('repost_count');

drop trigger if exists t_comments_count on public.comments;
create trigger t_comments_count after insert or delete on public.comments
for each row execute function public.bump_post_counter('comment_count');

drop trigger if exists t_impressions_count on public.post_impressions;
create trigger t_impressions_count after insert or delete on public.post_impressions
for each row execute function public.bump_post_counter('view_count');

-- ---------- follow counters ----------
create or replace function public.bump_follow_counters()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set followers = followers + 1 where id = new.target_id;
    update public.profiles set following = following + 1 where id = new.follower_id;
  else
    update public.profiles set followers = greatest(0, followers - 1) where id = old.target_id;
    update public.profiles set following = greatest(0, following - 1) where id = old.follower_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists t_follow_counters on public.follows;
create trigger t_follow_counters after insert or delete on public.follows
for each row execute function public.bump_follow_counters();

-- ---------- story likes ----------
create or replace function public.bump_story_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.stories set likes_count = likes_count + 1 where id = new.story_id;
  else
    update public.stories set likes_count = greatest(0, likes_count - 1) where id = old.story_id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists t_story_likes_count on public.story_likes;
create trigger t_story_likes_count after insert or delete on public.story_likes
for each row execute function public.bump_story_likes();

-- ---------- conversation preview / ordering ----------
create or replace function public.touch_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set preview = left(new.body, 160), updated_at = now()
   where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists t_touch_conversation on public.messages;
create trigger t_touch_conversation after insert on public.messages
for each row execute function public.touch_conversation();

-- ---------- notifications for social activity ----------
create or replace function public.notify_engagement()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_id uuid; kind text := tg_argv[0]; actor uuid; label text;
begin
  if kind = 'follow' then
    owner_id := new.target_id; actor := new.follower_id;
  else
    select user_id into owner_id from public.posts where id = new.post_id;
    actor := new.user_id;
  end if;
  if owner_id is null or owner_id = actor then return new; end if;
  select coalesce(display_name, username) into label from public.profiles where id = actor;
  insert into public.notifications (recipient_id, actor_id, type, body)
  values (owner_id, actor, kind,
    case kind
      when 'like' then coalesce(label,'Someone') || ' liked your post'
      when 'repost' then coalesce(label,'Someone') || ' reposted your post'
      when 'comment' then coalesce(label,'Someone') || ' commented on your post'
      when 'follow' then coalesce(label,'Someone') || ' started following you'
      else coalesce(label,'Someone') || ' interacted with your post'
    end);
  return new;
end $$;

drop trigger if exists t_notify_like on public.likes;
create trigger t_notify_like after insert on public.likes
for each row execute function public.notify_engagement('like');

drop trigger if exists t_notify_repost on public.reposts;
create trigger t_notify_repost after insert on public.reposts
for each row execute function public.notify_engagement('repost');

drop trigger if exists t_notify_comment on public.comments;
create trigger t_notify_comment after insert on public.comments
for each row execute function public.notify_engagement('comment');

drop trigger if exists t_notify_follow on public.follows;
create trigger t_notify_follow after insert on public.follows
for each row execute function public.notify_engagement('follow');

-- ---------- notifications for tips and direct messages ----------
create or replace function public.notify_tip()
returns trigger language plpgsql security definer set search_path = public as $$
declare label text;
begin
  select coalesce(display_name, username) into label from public.profiles where id = new.from_user_id;
  insert into public.notifications (recipient_id, actor_id, type, body)
  values (new.to_user_id, new.from_user_id, 'tip',
          coalesce(label,'Someone') || ' sent you a tip');
  return new;
end $$;

drop trigger if exists t_notify_tip on public.tips;
create trigger t_notify_tip after insert on public.tips
for each row execute function public.notify_tip();

create or replace function public.notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; label text;
begin
  select case when c.user_a = new.sender_id then c.user_b else c.user_a end
    into recipient from public.conversations c where c.id = new.conversation_id;
  if recipient is null or recipient = new.sender_id then return new; end if;
  select coalesce(display_name, username) into label from public.profiles where id = new.sender_id;
  insert into public.notifications (recipient_id, actor_id, type, body)
  values (recipient, new.sender_id, 'message',
          coalesce(label,'Someone') || ' sent you a message');
  return new;
end $$;

drop trigger if exists t_notify_message on public.messages;
create trigger t_notify_message after insert on public.messages
for each row execute function public.notify_message();

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['posts','likes','reposts','comments','follows','messages','conversations',
                           'notifications','stories','story_likes','spaces','space_participants',
                           'space_messages','tips','payouts','profiles']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;