revoke execute on function public.bump_post_counter() from anon, authenticated;
revoke execute on function public.bump_follow_counters() from anon, authenticated;
revoke execute on function public.bump_story_likes() from anon, authenticated;
revoke execute on function public.touch_conversation() from anon, authenticated;
revoke execute on function public.notify_engagement() from anon, authenticated;
revoke execute on function public.notify_tip() from anon, authenticated;
revoke execute on function public.notify_message() from anon, authenticated;
revoke execute on function public.record_post_impression(uuid) from anon;