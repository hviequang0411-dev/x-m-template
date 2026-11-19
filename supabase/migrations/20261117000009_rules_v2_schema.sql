-- 0009 · ruleset v2 + schema for: 2–4 players, waiting members, bots, points balance, admin
-- Rule decisions R01b, R34–R38 (docs/RULE_DECISIONS.md), approved 2026-11-17.

-- ---------------------------------------------------------------------------
-- Ruleset v2. Must match XAM_BASELINE_V2 in the engine (a unit test parses this file).
-- New rooms use the latest approved version; v1 rows/matches stay valid.
-- ---------------------------------------------------------------------------
insert into public.game_rulesets (code, version, status, config) values (
  'xam-baseline', 2, 'APPROVED',
  '{
    "code": "xam-baseline",
    "version": 2,
    "minPlayers": 2,
    "maxPlayers": 5,
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
    "scoring": { "perCard": 1, "congPenalty": 15, "thoi2": 0, "thoiTuQuy": 0, "minBalanceToPlay": 10, "capLossAtBalance": true },
    "turnTimeoutSeconds": 30,
    "flags": { "baoSam": false, "baoMotDen": false, "instantWin": false, "chainBomb": false },
    "botMatchesRanked": false
  }'::jsonb
);

-- ---------------------------------------------------------------------------
-- profiles: total_score is now a points BALANCE: new accounts start with 10 [R34] and it never
-- goes below 0 [R35]. Flags are writable only by the server (column grants are unchanged:
-- clients may update display_name / avatar_url only).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column is_admin  boolean not null default false,
  add column is_locked boolean not null default false,
  add column is_bot    boolean not null default false;

update public.profiles set total_score = greatest(total_score, 0);
alter table public.profiles alter column total_score set default 10;
alter table public.profiles add constraint profiles_total_score_nonnegative check (total_score >= 0);

-- Is the CALLER an admin? Used by RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = (select auth.uid())), false);
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- room_players: WAITING members [R37]. They are room members (see the room, its chat-less topic and
-- the public match state) but have no seat; they move into free seats in join order when the
-- room is WAITING (after a match ends or a seat frees up).
-- ---------------------------------------------------------------------------
alter table public.room_players
  add column role text not null default 'PLAYER' check (role in ('PLAYER', 'WAITING'));
alter table public.room_players alter column seat drop not null;
alter table public.room_players
  add constraint room_players_role_seat check ((role = 'PLAYER') = (seat is not null));

-- The previous winner leads the next match [R14]. With 2–4 players match seats are re-numbered
-- each match, so remember the winner by user, not by seat.
alter table public.game_rooms add column last_winner_user_id uuid references public.profiles (id);

-- Matches with a bot are unranked [R36]: no points change, no results/history rows.
alter table public.matches add column ranked boolean not null default true;

-- ---------------------------------------------------------------------------
-- point_adjustments: every admin change to a balance, for auditing [R38].
-- ---------------------------------------------------------------------------
create table public.point_adjustments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  admin_id      uuid not null references public.profiles (id),
  delta         integer not null check (delta <> 0 and delta between -100000 and 100000),
  reason        text not null check (char_length(btrim(reason)) between 3 and 200),
  balance_after integer not null check (balance_after >= 0),
  created_at    timestamptz not null default now()
);
create index point_adjustments_user_idx on public.point_adjustments (user_id, created_at desc);

alter table public.point_adjustments enable row level security;
revoke all on table public.point_adjustments from anon, authenticated;
grant all on table public.point_adjustments to service_role;
grant select on table public.point_adjustments to authenticated;
create policy point_adjustments_select_admins
  on public.point_adjustments for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Watching a match: seated players AND waiting members of the match's room may read the PUBLIC
-- match tables and its Realtime topic. Hands (player_private_states) stay owner-only, and
-- match_results stay players-only.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_match_player(p_match_id)
      or exists (select 1 from public.matches m where m.id = p_match_id and public.is_room_member(m.room_id));
$$;
revoke all on function public.can_view_match(uuid) from public, anon;
grant execute on function public.can_view_match(uuid) to authenticated, service_role;

drop policy matches_select_players on public.matches;
create policy matches_select_viewers
  on public.matches for select to authenticated
  using (public.can_view_match(id));

drop policy match_players_select_players on public.match_players;
create policy match_players_select_viewers
  on public.match_players for select to authenticated
  using (public.can_view_match(match_id));

drop policy game_actions_select_players on public.game_actions;
create policy game_actions_select_viewers
  on public.game_actions for select to authenticated
  using (public.can_view_match(match_id));

create or replace function public.can_access_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id   text := split_part(p_topic, ':', 2);
begin
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_topic <> v_kind || ':' || v_id then
    return false;
  end if;
  if v_kind = 'room' then
    return public.is_room_member(v_id::uuid);
  elsif v_kind = 'match' then
    return public.can_view_match(v_id::uuid);
  end if;
  return false;
end;
$$;
