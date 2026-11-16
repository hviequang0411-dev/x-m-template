-- Schema integrity: profile trigger, ruleset immutability, room/seat/match constraints.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- Users (the profile trigger runs on insert) -----------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('d0000000-0000-0000-0000-000000000001', 'dave@test.local', '{"username":"dave"}', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000002', 'erin@test.local', '{"username":"Erin","display_name":"Erin E"}', 'authenticated', 'authenticated');

select is((select display_name from public.profiles where id = 'd0000000-0000-0000-0000-000000000001'),
  'dave', 'display_name falls back to username');
select is((select username from public.profiles where id = 'd0000000-0000-0000-0000-000000000002'),
  'erin', 'username is lower-cased by the trigger');

select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role)
    values (gen_random_uuid(), 'bad@test.local', '{"username":"no spaces!"}', 'authenticated', 'authenticated')$$,
  'P0001', 'INVALID_USERNAME', 'invalid username blocks sign-up');
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role)
    values (gen_random_uuid(), 'dup@test.local', '{"username":"dave"}', 'authenticated', 'authenticated')$$,
  '23505', null, 'duplicate username blocks sign-up');
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role)
    values (gen_random_uuid(), 'none@test.local', '{}', 'authenticated', 'authenticated')$$,
  'P0001', 'INVALID_USERNAME', 'missing username blocks sign-up');

-- Ruleset ------------------------------------------------------------------------
select is((select count(*)::int from public.game_rulesets where code = 'xam-baseline' and version = 1 and status = 'APPROVED'),
  1, 'xam-baseline v1 is seeded and APPROVED');
select is((select (config ->> 'handSize')::int from public.game_rulesets where code = 'xam-baseline' and version = 1),
  10, 'approved hand size is 10 (R01)');
select throws_ok(
  $$update public.game_rulesets set config = config || '{"handSize":13}' where code = 'xam-baseline' and version = 1$$,
  'P0001', 'RULESET_IMMUTABLE', 'approved ruleset config cannot change');

-- Rooms and seats ----------------------------------------------------------------
select throws_ok(
  $$insert into public.game_rooms (code, host_id, ruleset_id)
    values ('abc', 'd0000000-0000-0000-0000-000000000001', (select id from public.game_rulesets limit 1))$$,
  '23514', null, 'room code format is enforced');
select throws_ok(
  $$insert into public.game_rooms (code, host_id, ruleset_id, max_players)
    values ('ABCDEF', 'd0000000-0000-0000-0000-000000000001', (select id from public.game_rulesets limit 1), 5)$$,
  '23514', null, 'room capacity must be 4');

insert into public.game_rooms (id, code, host_id, ruleset_id) values
  ('e0000000-0000-0000-0000-000000000001', 'QWERTY', 'd0000000-0000-0000-0000-000000000001',
    (select id from public.game_rulesets where code = 'xam-baseline' and version = 1)),
  ('e0000000-0000-0000-0000-000000000002', 'ZXCVBN', 'd0000000-0000-0000-0000-000000000002',
    (select id from public.game_rulesets where code = 'xam-baseline' and version = 1));

select lives_ok(
  $$insert into public.room_players (room_id, user_id, seat)
    values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 0)$$,
  'host takes seat 0');
select throws_ok(
  $$insert into public.room_players (room_id, user_id, seat)
    values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 0)$$,
  '23505', null, 'two active players cannot share a seat');
select throws_ok(
  $$insert into public.room_players (room_id, user_id, seat)
    values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1)$$,
  '23505', null, 'a player cannot join the same room twice');
select throws_ok(
  $$insert into public.room_players (room_id, user_id, seat)
    values ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 0)$$,
  '23505', null, 'a player can be active in only one room');

-- Matches, hands, actions --------------------------------------------------------
insert into public.matches (id, room_id, ruleset_id, match_no, current_seat) values
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
    (select id from public.game_rulesets where code = 'xam-baseline' and version = 1), 1, 0);
insert into public.match_players (match_id, user_id, seat, card_count) values
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 0, 2);

select throws_ok(
  $$insert into public.player_private_states (match_id, user_id, hand)
    values ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '{1S,3H}')$$,
  '23514', null, 'invalid card codes are rejected');
select throws_ok(
  $$insert into public.player_private_states (match_id, user_id, hand)
    values ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '{3H,3H}')$$,
  '23514', null, 'duplicate cards in a hand are rejected');
select throws_ok(
  $$insert into public.player_private_states (match_id, user_id, hand)
    values ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', '{3H}')$$,
  '23503', null, 'a hand cannot exist for a player who is not seated in the match');
select throws_ok(
  $$insert into public.matches (room_id, ruleset_id, match_no, current_seat)
    values ('e0000000-0000-0000-0000-000000000001', (select id from public.game_rulesets limit 1), 2, 0)$$,
  '23505', null, 'only one PLAYING match per room');

select throws_ok(
  $$insert into public.game_actions (match_id, action_id, seat, action_type, version_after)
    values ('f0000000-0000-0000-0000-000000000001', gen_random_uuid(), 0, 'PLAY', 1)$$,
  '23514', null, 'a PLAY action must carry cards and a combination');

insert into public.game_actions (match_id, action_id, action_type, version_after) values
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'DEAL', 0);

select throws_ok(
  $$insert into public.game_actions (match_id, action_id, seat, action_type, version_after)
    values ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 0, 'PASS', 1)$$,
  '23505', null, 'a duplicate action_id is rejected (idempotency)');
select throws_ok(
  $$insert into public.game_actions (match_id, action_id, seat, action_type, version_after)
    values ('f0000000-0000-0000-0000-000000000001', gen_random_uuid(), 0, 'PASS', 0)$$,
  '23505', null, 'two actions cannot commit the same version');

select ok(public.is_valid_card_array('{}'::text[]), 'an empty hand is valid');

select * from finish();
rollback;
