-- ============ money ============
alter table public.tips
  add column if not exists amount_minor bigint,
  add column if not exists fee_minor bigint not null default 0,
  add column if not exists net_minor bigint,
  add column if not exists status text not null default 'succeeded',
  add column if not exists reference text;
update public.tips set amount_minor = round(amount * 100)::bigint where amount_minor is null;
update public.tips set net_minor = coalesce(amount_minor,0) - fee_minor where net_minor is null;
create unique index if not exists tips_reference_key on public.tips(reference) where reference is not null;

alter table public.payments
  add column if not exists amount_minor bigint,
  add column if not exists platform_fee_minor bigint not null default 0,
  add column if not exists refunded_minor bigint not null default 0;
update public.payments set amount_minor = round(amount * 100)::bigint where amount_minor is null;

alter table public.payouts
  add column if not exists amount_minor bigint,
  add column if not exists fee_minor bigint not null default 0,
  add column if not exists requested_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists kyc_status text not null default 'unverified',
  add column if not exists reversal_of uuid references public.payouts(id) on delete set null;
update public.payouts set amount_minor = round(amount * 100)::bigint where amount_minor is null;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  direction text not null check (direction in ('credit','debit')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'USD',
  status text not null default 'available' check (status in ('pending','available','paid','reversed')),
  source_type text,
  source_id uuid,
  reference text,
  memo text,
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_user_idx on public.ledger_entries(user_id, created_at desc);
create unique index if not exists ledger_entries_ref_key on public.ledger_entries(kind, reference) where reference is not null;
grant select on public.ledger_entries to authenticated;
grant all on public.ledger_entries to service_role;
alter table public.ledger_entries enable row level security;
create policy "ledger owner read" on public.ledger_entries for select to authenticated
  using (public.owns_profile(user_id) or public.is_staff());

create table if not exists public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists provider_events_key on public.provider_events(provider, event_id);
grant all on public.provider_events to service_role;
alter table public.provider_events enable row level security;
create policy "provider events staff read" on public.provider_events for select to authenticated
  using (public.is_staff());

-- ============ recommendations / graph ============
create table if not exists public.author_affinity (
  user_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  score double precision not null default 0,
  interactions integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, author_id)
);
create index if not exists author_affinity_user_idx on public.author_affinity(user_id, score desc);
grant select on public.author_affinity to authenticated;
grant all on public.author_affinity to service_role;
alter table public.author_affinity enable row level security;
create policy "affinity owner read" on public.author_affinity for select to authenticated
  using (public.owns_profile(user_id));

create table if not exists public.post_not_interested (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists not_interested_post_key on public.post_not_interested(user_id, post_id) where post_id is not null;
create unique index if not exists not_interested_author_key on public.post_not_interested(user_id, author_id) where author_id is not null;
grant select, insert, delete on public.post_not_interested to authenticated;
grant all on public.post_not_interested to service_role;
alter table public.post_not_interested enable row level security;
create policy "ni owner all" on public.post_not_interested for all to authenticated
  using (public.owns_profile(user_id)) with check (public.owns_profile(user_id));

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
grant select, insert, delete on public.user_blocks to authenticated;
grant all on public.user_blocks to service_role;
alter table public.user_blocks enable row level security;
create policy "blocks owner all" on public.user_blocks for all to authenticated
  using (public.owns_profile(blocker_id)) with check (public.owns_profile(blocker_id));

create table if not exists public.user_mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id)
);
grant select, insert, delete on public.user_mutes to authenticated;
grant all on public.user_mutes to service_role;
alter table public.user_mutes enable row level security;
create policy "mutes owner all" on public.user_mutes for all to authenticated
  using (public.owns_profile(muter_id)) with check (public.owns_profile(muter_id));

create unique index if not exists post_impressions_unique_viewer
  on public.post_impressions(post_id, user_id) where user_id is not null;

-- ============ messaging ============
alter table public.messages
  add column if not exists body_cipher text,
  add column if not exists body_nonce text,
  add column if not exists enc_version integer not null default 0,
  add column if not exists delivered_at timestamptz,
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

-- ============ calls ============
alter table public.calls
  add column if not exists ring_expires_at timestamptz,
  add column if not exists decline_reason text,
  add column if not exists missed boolean not null default false,
  add column if not exists screen_shared boolean not null default false;

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_to_idx on public.call_signals(to_id, consumed, created_at);
grant select, insert, update on public.call_signals to authenticated;
grant all on public.call_signals to service_role;
alter table public.call_signals enable row level security;
create policy "signals participant read" on public.call_signals for select to authenticated
  using (public.owns_profile(to_id) or public.owns_profile(from_id));
create policy "signals sender insert" on public.call_signals for insert to authenticated
  with check (public.owns_profile(from_id));
create policy "signals recipient update" on public.call_signals for update to authenticated
  using (public.owns_profile(to_id)) with check (public.owns_profile(to_id));

-- ============ workspaces ============
alter table public.workspace_members
  add column if not exists invite_token text,
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists permissions jsonb not null default '{}'::jsonb;
create unique index if not exists workspace_members_token_key on public.workspace_members(invite_token) where invite_token is not null;

create or replace function public.notify_workspace_invite()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare wname text; target uuid;
begin
  if new.status <> 'invited' then return new; end if;
  select id into target from public.profiles where lower(email_hint) = lower(new.email) limit 1;
  if target is null then
    select p.id into target from public.profiles p
      join auth.users u on u.id = p.auth_user_id
     where lower(u.email) = lower(new.email) limit 1;
  end if;
  if target is null then return new; end if;
  select name into wname from public.workspaces where id = new.workspace_id;
  insert into public.notifications (recipient_id, actor_id, type, body, entity_type, entity_id)
  values (target, new.invited_by, 'workspace_invite',
          'You were invited to join ' || coalesce(wname,'a workspace'),
          'workspace_member', new.id);
  return new;
end $$;
revoke execute on function public.notify_workspace_invite() from anon, authenticated, public;
drop trigger if exists t_notify_workspace_invite on public.workspace_members;
create trigger t_notify_workspace_invite after insert on public.workspace_members
  for each row execute function public.notify_workspace_invite();

-- ============ developer api ============
alter table public.api_keys
  add column if not exists expires_at timestamptz,
  add column if not exists rate_limit_per_min integer not null default 60,
  add column if not exists last_ip text;

create table if not exists public.api_key_usage (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.api_keys(id) on delete cascade,
  minute timestamptz not null,
  count integer not null default 1,
  created_at timestamptz not null default now()
);
create unique index if not exists api_key_usage_key on public.api_key_usage(key_id, minute);
grant select on public.api_key_usage to authenticated;
grant all on public.api_key_usage to service_role;
alter table public.api_key_usage enable row level security;
create policy "usage owner read" on public.api_key_usage for select to authenticated
  using (exists (select 1 from public.api_keys k where k.id = key_id and public.owns_profile(k.user_id)));

alter table public.webhooks
  add column if not exists secret text,
  add column if not exists last_delivery_at timestamptz,
  add column if not exists failure_count integer not null default 0;

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event text not null,
  status_code integer,
  ok boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_idx on public.webhook_deliveries(webhook_id, created_at desc);
grant select on public.webhook_deliveries to authenticated;
grant all on public.webhook_deliveries to service_role;
alter table public.webhook_deliveries enable row level security;
create policy "deliveries owner read" on public.webhook_deliveries for select to authenticated
  using (exists (select 1 from public.webhooks w where w.id = webhook_id and public.owns_profile(w.user_id)));

-- ============ admin ============
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text not null default '',
  rollout integer not null default 100 check (rollout between 0 and 100),
  updated_at timestamptz not null default now()
);
grant select on public.feature_flags to authenticated, anon;
grant all on public.feature_flags to service_role;
alter table public.feature_flags enable row level security;
create policy "flags readable" on public.feature_flags for select using (true);
create policy "flags admin write" on public.feature_flags for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
insert into public.feature_flags(key, enabled, description) values
  ('stories', true, 'Stories and story replies'),
  ('spaces', true, 'Audio spaces'),
  ('calls', true, 'Voice and video calls'),
  ('tips', true, 'Creator tips'),
  ('subscriptions', true, 'Paid subscriptions'),
  ('ai_compose', true, 'AI writing assistance'),
  ('developer_api', true, 'Developer API keys and webhooks')
on conflict (key) do nothing;

create table if not exists public.user_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  until timestamptz,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz
);
create index if not exists suspensions_user_idx on public.user_suspensions(user_id, active);
grant select on public.user_suspensions to authenticated;
grant all on public.user_suspensions to service_role;
alter table public.user_suspensions enable row level security;
create policy "suspensions visible" on public.user_suspensions for select to authenticated
  using (public.owns_profile(user_id) or public.is_staff());
create policy "suspensions staff write" on public.user_suspensions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create table if not exists public.suspension_appeals (
  id uuid primary key default gen_random_uuid(),
  suspension_id uuid not null references public.user_suspensions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  status text not null default 'open' check (status in ('open','accepted','rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert on public.suspension_appeals to authenticated;
grant all on public.suspension_appeals to service_role;
alter table public.suspension_appeals enable row level security;
create policy "appeals visible" on public.suspension_appeals for select to authenticated
  using (public.owns_profile(user_id) or public.is_staff());
create policy "appeals own insert" on public.suspension_appeals for insert to authenticated
  with check (public.owns_profile(user_id));
create policy "appeals staff write" on public.suspension_appeals for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop trigger if exists t_appeals_updated on public.suspension_appeals;
create trigger t_appeals_updated before update on public.suspension_appeals
  for each row execute function public.set_updated_at();
