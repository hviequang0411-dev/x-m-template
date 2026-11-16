-- 0002 · game_rooms, room_players
-- Writes happen only through SECURITY DEFINER RPCs called by Edge Functions
-- (create_room / join_room / leave_room are added on Day 5).

create table public.game_rooms (
  id               uuid primary key default gen_random_uuid(),
  -- 6 chars, no ambiguous characters (no 0/O/1/I).
  code             text not null check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_id          uuid not null references public.profiles (id),
  ruleset_id       uuid not null references public.game_rulesets (id),
  status           text not null default 'WAITING' check (status in ('WAITING', 'PLAYING', 'CLOSED')),
  max_players      smallint not null default 4 check (max_players = 4),
  current_match_id uuid,  -- FK added in 0003 (matches does not exist yet)
  last_winner_seat smallint check (last_winner_seat between 0 and 3),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz,
  constraint game_rooms_code_key unique (code),
  constraint game_rooms_closed_at_consistent check ((status = 'CLOSED') = (closed_at is not null))
);

create index game_rooms_status_idx on public.game_rooms (status);
create index game_rooms_host_id_idx on public.game_rooms (host_id);

create trigger game_rooms_set_updated_at
  before update on public.game_rooms
  for each row execute function public.set_updated_at();

create table public.room_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  seat       smallint not null check (seat between 0 and 3),
  status     text not null default 'ACTIVE' check (status in ('ACTIVE', 'LEFT')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint room_players_left_at_consistent check ((status = 'LEFT') = (left_at is not null))
);

-- No duplicate joins, no seat collisions, and one active room per user (MVP).
create unique index room_players_active_member_key on public.room_players (room_id, user_id) where status = 'ACTIVE';
create unique index room_players_active_seat_key on public.room_players (room_id, seat) where status = 'ACTIVE';
create unique index room_players_one_active_room_key on public.room_players (user_id) where status = 'ACTIVE';
create index room_players_room_id_idx on public.room_players (room_id);

-- Membership helper used by RLS policies. SECURITY DEFINER avoids recursive
-- policy evaluation on room_players; it only answers about the caller.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = p_room_id
      and rp.user_id = (select auth.uid())
      and rp.status = 'ACTIVE'
  );
$$;

revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated, service_role;

-- RLS + grants -------------------------------------------------------------
alter table public.game_rooms enable row level security;
revoke all on table public.game_rooms from anon, authenticated;
grant all on table public.game_rooms to service_role;
grant select on table public.game_rooms to authenticated;

create policy game_rooms_select_members
  on public.game_rooms for select to authenticated
  using (public.is_room_member(id));

alter table public.room_players enable row level security;
revoke all on table public.room_players from anon, authenticated;
grant all on table public.room_players to service_role;
grant select on table public.room_players to authenticated;

create policy room_players_select_members
  on public.room_players for select to authenticated
  using (public.is_room_member(room_id));
