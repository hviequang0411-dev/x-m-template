-- 0016 · Support up to 5 seated players (seats 0..4), 10 members max in room,
-- and room-level scoreboard visibility on match_results.

-- 1. game_rooms & room_players
alter table public.game_rooms drop constraint if exists game_rooms_max_players_check;
alter table public.game_rooms alter column max_players set default 5;
alter table public.game_rooms
  add constraint game_rooms_max_players_check check (max_players between 4 and 5);
update public.game_rooms set max_players = 5 where status <> 'CLOSED';

alter table public.game_rooms drop constraint if exists game_rooms_last_winner_seat_check;
alter table public.game_rooms
  add constraint game_rooms_last_winner_seat_check check (last_winner_seat between 0 and 4);

alter table public.room_players drop constraint if exists room_players_seat_check;
alter table public.room_players
  add constraint room_players_seat_check check (seat between 0 and 4);

-- 2. matches, match_players, game_actions, match_results
alter table public.matches drop constraint if exists matches_current_seat_check;
alter table public.matches
  add constraint matches_current_seat_check check (current_seat between 0 and 4);

alter table public.matches drop constraint if exists matches_lead_seat_check;
alter table public.matches
  add constraint matches_lead_seat_check check (lead_seat between 0 and 4);

alter table public.matches drop constraint if exists matches_winner_seat_check;
alter table public.matches
  add constraint matches_winner_seat_check check (winner_seat between 0 and 4);

alter table public.matches drop constraint if exists matches_sam_seat_check;
alter table public.matches
  add constraint matches_sam_seat_check check (sam_seat between 0 and 4);

alter table public.matches drop constraint if exists matches_foul_seat_check;
alter table public.matches
  add constraint matches_foul_seat_check check (foul_seat between 0 and 4);

alter table public.matches drop constraint if exists matches_passed_seats_valid;
alter table public.matches
  add constraint matches_passed_seats_valid check (passed_seats <@ '{0,1,2,3,4}'::smallint[]);

alter table public.match_players drop constraint if exists match_players_seat_check;
alter table public.match_players
  add constraint match_players_seat_check check (seat between 0 and 4);

alter table public.game_actions drop constraint if exists game_actions_seat_check;
alter table public.game_actions
  add constraint game_actions_seat_check check (seat between 0 and 4);

alter table public.match_results drop constraint if exists match_results_seat_check;
alter table public.match_results
  add constraint match_results_seat_check check (seat between 0 and 4);

-- 3. Allow up to 10 active room members (5 seated players + 5 waiting)
create or replace function public.room_member_cap() returns int language sql immutable as $$ select 10 $$;
revoke all on function public.room_member_cap() from public, anon, authenticated;
grant execute on function public.room_member_cap() to service_role;

-- 4. Update approved xam-baseline v2 ruleset config to maxPlayers = 5
alter table public.game_rulesets disable trigger game_rulesets_immutable;
update public.game_rulesets
set config = jsonb_set(config, '{maxPlayers}', '5'::jsonb)
where code = 'xam-baseline' and version = 2;
alter table public.game_rulesets enable trigger game_rulesets_immutable;

-- 5. Allow any room member/viewer to read match_results for room scoreboard ranking
drop policy if exists match_results_select_players on public.match_results;
drop policy if exists match_results_select_viewers on public.match_results;
create policy match_results_select_viewers
  on public.match_results for select to authenticated
  using (public.can_view_match(match_id));
