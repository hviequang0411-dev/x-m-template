-- Full security suite (T6.5, DATABASE §5): every write path is closed to clients, and the Day 6 RPCs
-- (results, timeout, abort) enforce their rules.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

-- 1. No client write privilege on any game table, for any operation --------------------------------
select ok(not has_table_privilege(r, 'public.' || t, op), format('%s has no %s on %s', r, op, t))
from unnest(array['game_rulesets', 'game_rooms', 'room_players', 'matches', 'match_players',
                  'player_private_states', 'game_actions', 'match_results']) t,
     unnest(array['INSERT', 'UPDATE', 'DELETE']) op,
     unnest(array['authenticated']) r;
-- 8 tables × 3 operations = 24 tests

select ok(not has_table_privilege('anon', 'public.' || t, 'SELECT'), format('anon cannot read %s', t))
from unnest(array['profiles', 'game_rooms', 'matches', 'player_private_states', 'match_results']) t;
-- 5 tests

-- profiles: only display_name / avatar_url are writable, never scores.
select ok(not has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE'), format('profiles.%s is not writable', c))
from unnest(array['total_score', 'matches_played', 'matches_won', 'username', 'id']) c;
-- 5 tests

-- 2. Every RPC is service_role only ----------------------------------------------------------------
select ok(not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
          and has_function_privilege('service_role', f, 'EXECUTE'), format('%s is service_role only', f))
from unnest(array[
  'public.create_room(uuid, text)', 'public.join_room(uuid, text)', 'public.leave_room(uuid, uuid)',
  'public.start_match(uuid, uuid, jsonb, smallint)',
  'public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb)',
  'public.finish_match(uuid, uuid)', 'public.match_public_state(uuid)', 'public.notify_room(uuid, text, jsonb)'
]) f;
-- 8 tests

-- 3. Day 6 RPC rules on a real match -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select ('e000000' || i || '-0000-0000-0000-000000000000')::uuid, 'sec' || i || '@test.local',
       jsonb_build_object('username', 'sec_user_' || i), 'authenticated', 'authenticated'
from generate_series(1, 4) i;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids select 'room', (public.create_room('e0000001-0000-0000-0000-000000000000') ->> 'roomId')::uuid;
select public.join_room(('e000000' || i || '-0000-0000-0000-000000000000')::uuid,
  (select code from public.game_rooms where id = (select v from ids where k = 'room')))
from generate_series(2, 4) i;

-- Seat i gets cards n ≡ i (mod 4) of the canonical deck; seat 0 = 3S 4S 5S … (10 cards).
insert into ids select 'match', (public.start_match('e0000001-0000-0000-0000-000000000000',
  (select v from ids where k = 'room'),
  (select jsonb_agg(hand order by seat) from (
     select seat, jsonb_agg(code order by n) hand from (
       select (n % 4) seat, n, r || s code
       from (select row_number() over () - 1 n, r, s
             from unnest(array['3','4','5','6','7','8','9','T','J','Q','K','A','2']) r,
                  unnest(array['S','C','D','H']) s) d
       where n < 40) x group by seat) y),
  0::smallint) ->> 'matchId')::uuid;

-- Timeout: an early claim is refused; after the deadline any player may claim for the current seat.
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000003-0000-0000-0000-000000000000', 1,
  'TIMEOUT_PLAY', '{3S}', '{"status":"PLAYING","currentSeat":3,"leadSeat":0,"currentTrick":{"type":"SINGLE","size":1,"keyRank":3,"cards":["3S"]},"passedSeats":[],"winnerSeat":null,"combination":"SINGLE"}') $$,
  (select v from ids where k = 'match')), 'P0001', 'TURN_NOT_EXPIRED', 'a timeout cannot be claimed before the deadline');
update public.matches set turn_deadline = now() - interval '1 second' where id = (select v from ids where k = 'match');
select is((public.apply_game_action((select v from ids where k = 'match'), gen_random_uuid(), 'e0000003-0000-0000-0000-000000000000', 1,
  'TIMEOUT_PLAY', '{3S}', '{"status":"PLAYING","currentSeat":3,"leadSeat":0,"currentTrick":{"type":"SINGLE","size":1,"keyRank":3,"cards":["3S"]},"passedSeats":[],"winnerSeat":null,"combination":"SINGLE"}'
  ) ->> 'version')::int, 2, 'after the deadline, seat 2 can claim seat 0''s turn');
select is((select user_id::text || ':' || seat || ':' || action_type from public.game_actions
           where match_id = (select v from ids where k = 'match') and version_after = 2),
  'e0000001-0000-0000-0000-000000000000:0:TIMEOUT_PLAY', 'the timeout move is logged for the seat whose turn it was');
select ok((select turn_deadline > now() from public.matches where id = (select v from ids where k = 'match')),
  'the next turn gets a fresh deadline');

-- Results are mandatory and verified when a match finishes.
-- Give seat 3 (current) a one-card hand so its next play wins.
update public.player_private_states set hand = '{2H}'
where match_id = (select v from ids where k = 'match') and user_id = 'e0000004-0000-0000-0000-000000000000';
update public.match_players set card_count = 1
where match_id = (select v from ids where k = 'match') and seat = 3;

create temp table win_next as select
  '{"status":"FINISHED","currentSeat":3,"leadSeat":3,"currentTrick":{"type":"SINGLE","size":1,"keyRank":15,"cards":["2H"]},"passedSeats":[],"winnerSeat":3,"combination":"SINGLE"}'::jsonb as next;
create temp table good_results as
select jsonb_agg(jsonb_build_object(
  'seat', seat,
  'isWinner', seat = 3,
  'remainingHand', case when seat = 3 then '[]'::jsonb else to_jsonb(hand) end,
  'remainingCards', case when seat = 3 then 0 else cardinality(hand) end,
  'scoreDelta', case seat when 3 then 9 + 15 + 15 when 0 then -9 else -15 end,
  'penalties', case when seat in (1, 2) then '{"cong":true}'::jsonb else '{}'::jsonb end) order by seat) as res
from public.match_players mp
join public.player_private_states ps using (match_id, user_id)
where mp.match_id = (select v from ids where k = 'match');

select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L) $$,
  (select v from ids where k = 'match'), (select next from win_next)), 'P0001', 'INTERNAL_ERROR', 'finishing without results is refused');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L, %L) $$,
  (select v from ids where k = 'match'), (select next from win_next),
  (select jsonb_set(jsonb_set(res, '{3,scoreDelta}', '100'), '{0,scoreDelta}', '-70') from good_results)),
  'P0001', 'INTERNAL_ERROR', 'inflated scores are refused');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L, %L) $$,
  (select v from ids where k = 'match'), (select next from win_next),
  (select jsonb_set(res, '{1,penalties}', '{}') from good_results)),
  'P0001', 'INTERNAL_ERROR', 'a missing cóng flag is refused');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L, %L) $$,
  (select v from ids where k = 'match'), (select next from win_next),
  (select res #- '{2,isWinner}' from good_results)),
  'P0001', 'INTERNAL_ERROR', 'a result without isWinner is refused');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L, %L) $$,
  (select v from ids where k = 'match'), (select jsonb_set(next, '{winnerSeat}', 'null') from win_next), (select res from good_results)),
  'P0001', 'INTERNAL_ERROR', 'a FINISHED state without a winner is refused');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L, %L) $$,
  (select v from ids where k = 'match'), (select next from win_next),
  (select jsonb_set(res, '{0,remainingHand}', '["4S"]') from good_results)),
  'P0001', 'INTERNAL_ERROR', 'a remaining hand that differs from the stored one is refused');

select lives_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'e0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{2H}', %L, %L) $$,
  (select v from ids where k = 'match'), (select next from win_next), (select res from good_results)), 'correct results are accepted');
select is((select array_agg(score_delta order by seat) from public.match_results where match_id = (select v from ids where k = 'match')),
  array[-9, -10, -10, 29], 'match_results hold what was paid: cóng 15 capped at the 10-point balance [R35]');
select is((select penalties ->> 'owed' from public.match_results where match_id = (select v from ids where k = 'match') and seat = 1),
  '15', 'a capped loss records what was owed');
select is((select array_agg(total_score::text || '/' || matches_played || '/' || matches_won order by id) from public.profiles
           where id in (select user_id from public.match_players where match_id = (select v from ids where k = 'match'))),
  array['1/1/0', '0/1/0', '0/1/0', '39/1/1'], 'profiles are updated once and never go below 0');
select is((select status from public.game_rooms where id = (select v from ids where k = 'room')), 'WAITING', 'room returns to WAITING [R31]');

-- Top balances back up so the next ranked match may start [R34].
update public.profiles set total_score = 10
where id in (select user_id from public.match_players where match_id = (select v from ids where k = 'match')) and total_score < 10;

-- 4. Abort (R30) ---------------------------------------------------------------------------------
insert into ids select 'match2', (public.start_match('e0000001-0000-0000-0000-000000000000',
  (select v from ids where k = 'room'),
  (select jsonb_agg(hand order by seat) from (
     select seat, jsonb_agg(code order by n) hand from (
       select (n % 4) seat, n, r || s code
       from (select row_number() over () - 1 n, r, s
             from unnest(array['3','4','5','6','7','8','9','T','J','Q','K','A','2']) r,
                  unnest(array['S','C','D','H']) s) d
       where n < 40) x group by seat) y),
  3::smallint) ->> 'matchId')::uuid;
select throws_ok(format($$ select public.finish_match('e0000002-0000-0000-0000-000000000000', %L) $$, (select v from ids where k = 'match2')),
  'P0001', 'NOT_ROOM_HOST', 'only the host may abort');
select throws_ok(format($$ select public.finish_match('e0000001-0000-0000-0000-000000000000', %L) $$, (select v from ids where k = 'match2')),
  'P0001', 'MATCH_NOT_STALLED', 'a match with a recent move cannot be aborted');
update public.game_actions set created_at = now() - interval '6 minutes' where match_id = (select v from ids where k = 'match2');
select is((public.finish_match('e0000001-0000-0000-0000-000000000000', (select v from ids where k = 'match2')) ->> 'status'),
  'ABORTED', 'a stalled match can be aborted by the host');
select is((select count(*)::int from public.match_results where match_id = (select v from ids where k = 'match2')), 0,
  'an aborted match scores nothing');

-- 5. Results are visible to the match's players only -----------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('e0000009-0000-0000-0000-000000000000', 'sec9@test.local', '{"username":"sec_outsider"}', 'authenticated', 'authenticated');
select set_config('request.jwt.claims', '{"sub":"e0000002-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.match_results where match_id = (select v from ids where k = 'match')), 4,
  'a player sees all four results of their match');
select set_config('request.jwt.claims', '{"sub":"e0000009-0000-0000-0000-000000000000","role":"authenticated"}', true);
select is((select count(*)::int from public.match_results), 0, 'an outsider sees no results');
reset role;

select * from finish();
rollback;
