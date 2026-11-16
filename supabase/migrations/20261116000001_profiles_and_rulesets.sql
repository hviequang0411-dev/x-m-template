-- 0001 · profiles, game_rulesets, shared helpers
-- Security model: clients read through RLS; they never write game data.
-- Supabase grants ALL on new public tables to anon/authenticated by default,
-- so every table here explicitly REVOKEs and then GRANTs the minimum.

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text not null,
  display_name   text not null,
  avatar_url     text,
  total_score    integer not null default 0,
  matches_played integer not null default 0 check (matches_played >= 0),
  matches_won    integer not null default 0 check (matches_won >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint profiles_username_key unique (username),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 32),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 500),
  constraint profiles_matches_won_le_played check (matches_won <= matches_played)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant all on table public.profiles to service_role;
grant select on table public.profiles to authenticated;
-- Column-level grant: clients can change only cosmetic fields, never stats.
grant update (display_name, avatar_url) on table public.profiles to authenticated;

create policy profiles_select_authenticated
  on public.profiles for select to authenticated
  using (true);  -- opponent names must be visible; profiles hold no secrets

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Create a profile for every new auth user. The username comes from sign-up
-- metadata and is re-validated here (never trust the client).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username     text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  v_display_name text := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME' using errcode = 'P0001';
  end if;
  if v_display_name = '' then
    v_display_name := v_username;
  end if;
  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, left(v_display_name, 32));
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- game_rulesets (immutable once APPROVED; a rule change = a new version)
-- ---------------------------------------------------------------------------
create table public.game_rulesets (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,
  version    integer not null check (version > 0),
  status     text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED', 'RETIRED')),
  config     jsonb not null,
  created_at timestamptz not null default now(),
  constraint game_rulesets_code_version_key unique (code, version)
);

-- Block edits to the config of an APPROVED ruleset (status may still move to RETIRED).
create or replace function public.prevent_approved_ruleset_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'APPROVED' and (new.config is distinct from old.config
      or new.code is distinct from old.code or new.version is distinct from old.version) then
    raise exception 'RULESET_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_approved_ruleset_edit() from public, anon, authenticated;

create trigger game_rulesets_immutable
  before update on public.game_rulesets
  for each row execute function public.prevent_approved_ruleset_edit();

alter table public.game_rulesets enable row level security;
revoke all on table public.game_rulesets from anon, authenticated;
grant all on table public.game_rulesets to service_role;
grant select on table public.game_rulesets to authenticated;

create policy game_rulesets_select_approved
  on public.game_rulesets for select to authenticated
  using (status = 'APPROVED');

-- Approved 2026-11-16 (docs/BUSINESS_RULES.md). Must match XAM_BASELINE_V1 in the engine.
insert into public.game_rulesets (code, version, status, config) values (
  'xam-baseline', 1, 'APPROVED',
  '{
    "code": "xam-baseline",
    "version": 1,
    "players": 4,
    "handSize": 10,
    "direction": "CCW",
    "suitsMatter": false,
    "straight": { "min": 3, "max": 10, "aceLow": true, "twoAllowed": "LOW_ONLY", "wrap": false },
    "fourOfAKindBeats": "SINGLE_TWO",
    "passLocksRound": true,
    "leaderCanPass": false,
    "firstLeader": "RANDOM",
    "nextLeader": "PREVIOUS_WINNER",
    "endCondition": "FIRST_OUT",
    "scoring": { "perCard": 1, "congPenalty": 15, "thoi2": 0, "thoiTuQuy": 0 },
    "turnTimeoutSeconds": 30,
    "flags": { "baoSam": false, "baoMotDen": false, "instantWin": false, "chainBomb": false }
  }'::jsonb
);
