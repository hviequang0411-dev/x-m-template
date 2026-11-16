-- 0003 · matches, match_players, player_private_states, game_actions, match_results
-- Public state (matches, match_players) is kept apart from secret state
-- (player_private_states). Writes go only through RPCs (added on Day 5).

-- Card codes: rank [3-9TJQKA2] + suit [SCDH], e.g. '3S', 'TH', '2D'.
create or replace function public.is_valid_card_array(p_cards text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_cards is not null
     and coalesce(bool_and(c ~ '^[2-9TJQKA][SCDH]$'), true)
     and count(distinct c) = count(*)  -- no duplicate cards
  from unnest(p_cards) as c;
$$;

grant execute on function public.is_valid_card_array(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- matches: public authoritative state
-- ---------------------------------------------------------------------------
create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.game_rooms (id) on delete cascade,
  ruleset_id     uuid not null references public.game_rulesets (id),
  match_no       integer not null check (match_no > 0),
  status         text not null default 'PLAYING' check (status in ('PLAYING', 'FINISHED', 'ABORTED')),
  version        bigint not null default 0 check (version >= 0),
  current_seat   smallint check (current_seat between 0 and 3),
  lead_seat      smallint check (lead_seat between 0 and 3),
  current_trick  jsonb,
  passed_seats   smallint[] not null default '{}',
  turn_deadline  timestamptz,
  winner_seat    smallint check (winner_seat between 0 and 3),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint matches_room_match_no_key unique (room_id, match_no),
  constraint matches_finished_consistent check ((status = 'PLAYING') = (finished_at is null)),
  constraint matches_playing_has_turn check (status <> 'PLAYING' or current_seat is not null),
  constraint matches_winner_only_when_finished check (winner_seat is null or status = 'FINISHED'),
  constraint matches_passed_seats_valid check (passed_seats <@ '{0,1,2,3}'::smallint[])
);

-- At most one live match per room.
create unique index matches_one_playing_per_room on public.matches (room_id) where status = 'PLAYING';
create index matches_room_status_idx on public.matches (room_id, status);

create trigger matches_set_updated_at
  before update on public.matches
  for each row execute function public.set_updated_at();

alter table public.game_rooms
  add constraint game_rooms_current_match_fk
  foreign key (current_match_id) references public.matches (id)
  on delete set null deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- match_players: public per-seat info
-- ---------------------------------------------------------------------------
create table public.match_players (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  seat       smallint not null check (seat between 0 and 3),
  card_count smallint not null check (card_count between 0 and 13),
  has_played boolean not null default false,
  status     text not null default 'PLAYING' check (status in ('PLAYING', 'WON', 'LOST', 'FORFEITED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint match_players_match_seat_key unique (match_id, seat),
  constraint match_players_match_user_key unique (match_id, user_id)
);

create index match_players_user_id_idx on public.match_players (user_id);

create trigger match_players_set_updated_at
  before update on public.match_players
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- player_private_states: SECRET hands — only the owner may read
-- ---------------------------------------------------------------------------
create table public.player_private_states (
  match_id   uuid not null,
  user_id    uuid not null,
  hand       text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id),
  -- Composite FK: a hand can exist only for a seated player of that match.
  constraint player_private_states_player_fk
    foreign key (match_id, user_id) references public.match_players (match_id, user_id) on delete cascade,
  constraint player_private_states_hand_valid
    check (public.is_valid_card_array(hand) and cardinality(hand) <= 13)
);

create index player_private_states_user_id_idx on public.player_private_states (user_id);

create trigger player_private_states_set_updated_at
  before update on public.player_private_states
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- game_actions: append-only log (only public, already-played cards)
-- ---------------------------------------------------------------------------
create table public.game_actions (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches (id) on delete cascade,
  action_id     uuid not null,  -- client-generated idempotency key
  user_id       uuid references public.profiles (id),  -- null for SYSTEM actions
  seat          smallint check (seat between 0 and 3),
  action_type   text not null check (action_type in
                  ('DEAL', 'PLAY', 'PASS', 'TIMEOUT_PASS', 'TIMEOUT_PLAY', 'ABORT', 'FINISH')),
  cards         text[] check (cards is null or (public.is_valid_card_array(cards) and cardinality(cards) between 1 and 10)),
  combination   text check (combination is null or combination in
                  ('SINGLE', 'PAIR', 'TRIPLE', 'STRAIGHT', 'FOUR_OF_A_KIND')),
  version_after bigint not null check (version_after >= 0),
  created_at    timestamptz not null default now(),
  constraint game_actions_match_action_key unique (match_id, action_id),
  -- Two commits on the same version are impossible.
  constraint game_actions_match_version_key unique (match_id, version_after),
  constraint game_actions_play_has_cards check (
    (action_type in ('PLAY', 'TIMEOUT_PLAY')) = (cards is not null and combination is not null))
);

create index game_actions_user_id_idx on public.game_actions (user_id);

-- ---------------------------------------------------------------------------
-- match_results: one row per player, written once at match end
-- ---------------------------------------------------------------------------
create table public.match_results (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.matches (id) on delete cascade,
  user_id         uuid not null references public.profiles (id),
  seat            smallint not null check (seat between 0 and 3),
  is_winner       boolean not null,
  remaining_cards smallint not null check (remaining_cards between 0 and 13),
  remaining_hand  text[] not null default '{}' check (public.is_valid_card_array(remaining_hand)),
  score_delta     integer not null,
  penalties       jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  constraint match_results_match_user_key unique (match_id, user_id),
  constraint match_results_match_seat_key unique (match_id, seat),
  constraint match_results_remaining_consistent check (remaining_cards = cardinality(remaining_hand))
);

create index match_results_user_history_idx on public.match_results (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Membership helper + RLS + grants
-- ---------------------------------------------------------------------------
create or replace function public.is_match_player(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players mp
    where mp.match_id = p_match_id and mp.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_match_player(uuid) from public, anon;
grant execute on function public.is_match_player(uuid) to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['matches', 'match_players', 'player_private_states', 'game_actions', 'match_results']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

create policy matches_select_players
  on public.matches for select to authenticated
  using (public.is_match_player(id));

create policy match_players_select_players
  on public.match_players for select to authenticated
  using (public.is_match_player(match_id));

-- The core secrecy rule: you can read only your own hand.
create policy player_private_states_select_own
  on public.player_private_states for select to authenticated
  using (user_id = (select auth.uid()));

create policy game_actions_select_players
  on public.game_actions for select to authenticated
  using (public.is_match_player(match_id));

create policy match_results_select_players
  on public.match_results for select to authenticated
  using (public.is_match_player(match_id));
