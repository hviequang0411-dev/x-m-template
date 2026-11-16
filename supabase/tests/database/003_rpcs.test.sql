-- Room/game RPCs (DATABASE §5) and Realtime topic authorization.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

-- Five users: u1..u4 fill a room, u5 is an outsider.
insert into auth.users (id, email, raw_user_meta_data, aud, role)
select ('d000000' || i || '-0000-0000-0000-000000000000')::uuid, 'rpc' || i || '@test.local',
       jsonb_build_object('username', 'rpc_user_' || i), 'authenticated', 'authenticated'
from generate_series(1, 5) i;

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- Grants: only the service role may execute the RPCs ------------------------------
select ok(not has_function_privilege('authenticated', 'public.create_room(uuid, text)', 'EXECUTE'), 'authenticated cannot execute create_room');
select ok(not has_function_privilege('authenticated', 'public.join_room(uuid, text)', 'EXECUTE'), 'authenticated cannot execute join_room');
select ok(not has_function_privilege('authenticated', 'public.leave_room(uuid, uuid)', 'EXECUTE'), 'authenticated cannot execute leave_room');
select ok(not has_function_privilege('authenticated', 'public.start_match(uuid, uuid, jsonb, smallint)', 'EXECUTE'), 'authenticated cannot execute start_match');
select ok(not has_function_privilege('authenticated', 'public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb)', 'EXECUTE'), 'authenticated cannot execute apply_game_action');
select ok(not has_function_privilege('anon', 'public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb)', 'EXECUTE'), 'anon cannot execute apply_game_action');
select ok(not has_function_privilege('authenticated', 'public.match_public_state(uuid)', 'EXECUTE'), 'authenticated cannot execute match_public_state');
select ok(has_function_privilege('service_role', 'public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb)', 'EXECUTE'), 'service_role can execute apply_game_action');

-- Rooms --------------------------------------------------------------------------
insert into ids select 'room', (public.create_room('d0000001-0000-0000-0000-000000000000') ->> 'roomId')::uuid;
select matches((select code from public.game_rooms where id = (select v from ids where k = 'room')),
  '^[A-HJ-NP-Z2-9]{6}$', 'create_room makes a 6-char code without ambiguous characters');
select throws_ok($$ select public.create_room('d0000001-0000-0000-0000-000000000000') $$,
  'P0001', 'ALREADY_IN_ROOM', 'a member cannot create a second room');

select is((public.join_room('d0000002-0000-0000-0000-000000000000',
  lower((select code from public.game_rooms where id = (select v from ids where k = 'room')))) ->> 'seat')::int,
  1, 'join_room takes the lowest free seat (codes are case-insensitive)');
select throws_ok(format($$ select public.join_room('d0000002-0000-0000-0000-000000000000', %L) $$,
  (select code from public.game_rooms where id = (select v from ids where k = 'room'))),
  'P0001', 'ALREADY_IN_ROOM', 'joining twice is refused');
select throws_ok($$ select public.join_room('d0000005-0000-0000-0000-000000000000', 'ZZZZZ9') $$,
  'P0001', 'ROOM_NOT_FOUND', 'unknown code');

-- Start with 2 players
select throws_ok(format($$ select public.start_match('d0000001-0000-0000-0000-000000000000', %L, '[]', 0::smallint) $$,
  (select v from ids where k = 'room')), 'P0001', 'NOT_ENOUGH_PLAYERS', 'start_match needs 4 players');

select public.join_room(('d000000' || i || '-0000-0000-0000-000000000000')::uuid,
  (select code from public.game_rooms where id = (select v from ids where k = 'room')))
from generate_series(3, 4) i;
select throws_ok(format($$ select public.join_room('d0000005-0000-0000-0000-000000000000', %L) $$,
  (select code from public.game_rooms where id = (select v from ids where k = 'room'))),
  'P0001', 'ROOM_FULL', 'a 5th player gets ROOM_FULL');

-- A valid deal: seat i gets cards i, i+4, … from the canonical deck order.
create temp table deal as
select jsonb_agg(hand order by seat) as hands from (
  select seat, jsonb_agg(code order by n) as hand
  from (
    select (n % 4) as seat, n, r || s as code
    from (select row_number() over () - 1 as n, r, s
          from unnest(array['3','4','5','6','7','8','9','T','J','Q','K','A','2']) r,
               unnest(array['S','C','D','H']) s) d
    where n < 40
  ) x group by seat
) y;

select throws_ok(format($$ select public.start_match('d0000002-0000-0000-0000-000000000000', %L, %L, 0::smallint) $$,
  (select v from ids where k = 'room'), (select hands from deal)), 'P0001', 'NOT_ROOM_HOST', 'only the host can start');
select throws_ok(format($$ select public.start_match('d0000005-0000-0000-0000-000000000000', %L, %L, 0::smallint) $$,
  (select v from ids where k = 'room'), (select hands from deal)), 'P0001', 'NOT_ROOM_MEMBER', 'an outsider cannot start');
select throws_ok(format($$ select public.start_match('d0000001-0000-0000-0000-000000000000', %L, %L, 0::smallint) $$,
  (select v from ids where k = 'room'), '[["3S"],["4S"],["5S"],["6S"]]'), 'P0001', 'INVALID_REQUEST', 'a short deal is rejected');
select throws_ok(format($$ select public.start_match('d0000001-0000-0000-0000-000000000000', %L, %L, 0::smallint) $$,
  (select v from ids where k = 'room'),
  (select jsonb_set(hands, '{1,0}', hands -> 0 -> 0) from deal)), 'P0001', 'INVALID_REQUEST', 'a deal with a duplicated card is rejected');

insert into ids select 'match', (public.start_match('d0000001-0000-0000-0000-000000000000',
  (select v from ids where k = 'room'), (select hands from deal), 0::smallint) ->> 'matchId')::uuid;
select is((select status from public.game_rooms where id = (select v from ids where k = 'room')), 'PLAYING', 'room is PLAYING');
select throws_ok(format($$ select public.leave_room('d0000002-0000-0000-0000-000000000000', %L) $$,
  (select v from ids where k = 'room')), 'P0001', 'MATCH_IN_PROGRESS', 'cannot leave mid-match');

-- apply_game_action ---------------------------------------------------------------
-- Seat 0 holds 3S 4D 6S 7D 9S TD QS KD 2S 2D... (n % 4 = 0); it leads with 3S.
insert into ids values ('action', gen_random_uuid());
select is((public.apply_game_action((select v from ids where k = 'match'), (select v from ids where k = 'action'),
  'd0000001-0000-0000-0000-000000000000', 1, 'PLAY', '{3S}',
  '{"status":"PLAYING","currentSeat":3,"leadSeat":0,"currentTrick":{"type":"SINGLE","size":1,"keyRank":3,"cards":["3S"]},"passedSeats":[],"winnerSeat":null,"combination":"SINGLE"}'
  ) ->> 'version')::int, 2, 'a valid play commits version 2');
select throws_ok(format($$ select public.apply_game_action(%L, %L, 'd0000001-0000-0000-0000-000000000000', 1, 'PLAY', '{3S}', '{}') $$,
  (select v from ids where k = 'match'), (select v from ids where k = 'action')),
  'P0001', 'ACTION_ALREADY_PROCESSED', 'the same action_id twice');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'd0000004-0000-0000-0000-000000000000', 1, 'PASS', null, '{}') $$,
  (select v from ids where k = 'match')), 'P0001', 'VERSION_CONFLICT', 'a stale version');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'd0000001-0000-0000-0000-000000000000', 2, 'PASS', null, '{}') $$,
  (select v from ids where k = 'match')), 'P0001', 'NOT_YOUR_TURN', 'out of turn (re-checked in SQL)');
select throws_ok(format($$ select public.apply_game_action(%L, gen_random_uuid(), 'd0000004-0000-0000-0000-000000000000', 2, 'PLAY', '{3S}', '{"combination":"SINGLE"}') $$,
  (select v from ids where k = 'match')), 'P0001', 'CARD_NOT_OWNED', 'cards must be in the stored hand (defence in depth)');

-- Realtime topic authorization ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"d0000002-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select ok(public.can_access_topic('match:' || (select v from ids where k = 'match'))
          and public.can_access_topic('room:' || (select v from ids where k = 'room')), 'a player may use the room and match topics');
select set_config('request.jwt.claims', '{"sub":"d0000005-0000-0000-0000-000000000000","role":"authenticated"}', true);
select ok(not public.can_access_topic('match:' || (select v from ids where k = 'match'))
          and not public.can_access_topic('room:not-a-uuid')
          and not public.can_access_topic('other:' || (select v from ids where k = 'room')), 'an outsider and malformed topics are refused');
reset role;

select * from finish();
rollback;
