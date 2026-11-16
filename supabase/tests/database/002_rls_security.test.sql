-- RLS and grants: players read only what they may, and can write nothing authoritative.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Setup as postgres ---------------------------------------------------------------
-- alice (A) and bob (B) share a room and a match; carol (C) is an outsider.
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a1111111-1111-1111-1111-111111111111', 'alice@test.local', '{"username":"alice"}', 'authenticated', 'authenticated'),
  ('b2222222-2222-2222-2222-222222222222', 'bob@test.local',   '{"username":"bob"}',   'authenticated', 'authenticated'),
  ('c3333333-3333-3333-3333-333333333333', 'carol@test.local', '{"username":"carol"}', 'authenticated', 'authenticated');

insert into public.game_rooms (id, code, host_id, ruleset_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'HJKLMN', 'a1111111-1111-1111-1111-111111111111',
    (select id from public.game_rulesets where code = 'xam-baseline' and version = 1));
insert into public.room_players (room_id, user_id, seat) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 0),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b2222222-2222-2222-2222-222222222222', 1);
insert into public.matches (id, room_id, ruleset_id, match_no, current_seat) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    (select id from public.game_rulesets where code = 'xam-baseline' and version = 1), 1, 0);
insert into public.match_players (match_id, user_id, seat, card_count) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a1111111-1111-1111-1111-111111111111', 0, 2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-2222-2222-2222-222222222222', 1, 2);
insert into public.player_private_states (match_id, user_id, hand) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a1111111-1111-1111-1111-111111111111', '{3S,4S}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-2222-2222-2222-222222222222', '{5H,6H}');
insert into public.game_actions (match_id, action_id, action_type, version_after) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', gen_random_uuid(), 'DEAL', 0);

-- As alice ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.player_private_states), 1, 'alice sees exactly one hand');
select is((select count(*)::int from public.player_private_states where user_id = 'a1111111-1111-1111-1111-111111111111'),
  1, 'alice sees her own hand');
select is((select count(*)::int from public.player_private_states where user_id = 'b2222222-2222-2222-2222-222222222222'),
  0, 'alice cannot see bob''s hand');
select is((select count(*)::int from public.game_rooms), 1, 'member sees her room');
select is((select count(*)::int from public.room_players), 2, 'member sees room seats');
select is((select count(*)::int from public.matches), 1, 'player sees her match');
select is((select count(*)::int from public.match_players), 2, 'player sees public seat info');
select is((select count(*)::int from public.game_actions), 1, 'player sees the action log');
select ok((select count(*) from public.profiles) >= 3, 'profiles are readable (names only)');
select is((select count(*)::int from public.game_rulesets), 2, 'approved rulesets are readable (v1 and v2)');

-- No writes to authoritative state (42501 = insufficient_privilege).
select throws_ok($$insert into public.game_rooms (code, host_id, ruleset_id)
  values ('PQRSTU', 'a1111111-1111-1111-1111-111111111111', (select id from public.game_rulesets limit 1))$$,
  '42501', null, 'cannot create rooms directly');
select throws_ok($$update public.game_rooms set status = 'CLOSED'$$, '42501', null, 'cannot change room status');
select throws_ok($$delete from public.game_rooms$$, '42501', null, 'cannot delete rooms');
select throws_ok($$insert into public.room_players (room_id, user_id, seat)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c3333333-3333-3333-3333-333333333333', 2)$$,
  '42501', null, 'cannot seat players directly');
select throws_ok($$update public.room_players set seat = 3$$, '42501', null, 'cannot move seats');
select throws_ok($$update public.matches set version = 99$$, '42501', null, 'cannot change match version');
select throws_ok($$update public.matches set winner_seat = 0, status = 'FINISHED', finished_at = now()$$,
  '42501', null, 'cannot declare a winner');
select throws_ok($$delete from public.matches$$, '42501', null, 'cannot delete matches');
select throws_ok($$update public.match_players set card_count = 0$$, '42501', null, 'cannot change card counts');
select throws_ok($$insert into public.player_private_states (match_id, user_id, hand)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'c3333333-3333-3333-3333-333333333333', '{2S}')$$,
  '42501', null, 'cannot insert hands');
select throws_ok($$update public.player_private_states set hand = '{2S,2H,2D,2C}'$$, '42501', null, 'cannot edit her own hand');
select throws_ok($$delete from public.player_private_states$$, '42501', null, 'cannot delete hands');
select throws_ok($$insert into public.game_actions (match_id, action_id, action_type, version_after)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', gen_random_uuid(), 'PASS', 1)$$,
  '42501', null, 'cannot insert trusted game events');
select throws_ok($$insert into public.match_results (match_id, user_id, seat, is_winner, remaining_cards, score_delta)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'a1111111-1111-1111-1111-111111111111', 0, true, 0, 100)$$,
  '42501', null, 'cannot write results');
select throws_ok($$insert into public.game_rulesets (code, version, status, config) values ('cheat', 1, 'APPROVED', '{}')$$,
  '42501', null, 'cannot add rulesets');
select throws_ok($$update public.profiles set total_score = 999 where id = 'a1111111-1111-1111-1111-111111111111'$$,
  '42501', null, 'cannot change her own score');
select throws_ok($$delete from public.profiles$$, '42501', null, 'cannot delete profiles');

select lives_ok($$update public.profiles set display_name = 'Alice A' where id = 'a1111111-1111-1111-1111-111111111111'$$,
  'can rename herself');
select lives_ok($$update public.profiles set display_name = 'Hacked' where id = 'b2222222-2222-2222-2222-222222222222'$$,
  'renaming someone else is silently filtered by RLS');

reset role;
select is((select display_name from public.profiles where id = 'b2222222-2222-2222-2222-222222222222'),
  'bob', 'bob''s name is unchanged');
select is((select display_name from public.profiles where id = 'a1111111-1111-1111-1111-111111111111'),
  'Alice A', 'alice''s rename was applied');

-- As carol (outsider) -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.game_rooms), 0, 'outsider sees no rooms');
select is((select count(*)::int from public.room_players), 0, 'outsider sees no seats');
select is((select count(*)::int from public.matches), 0, 'outsider sees no matches');
select is((select count(*)::int from public.player_private_states), 0, 'outsider sees no hands');
select is((select count(*)::int from public.game_actions), 0, 'outsider sees no actions');
reset role;

-- As anon -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select count(*) from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select count(*) from public.player_private_states$$, '42501', null, 'anon cannot read hands');
reset role;

select * from finish();
rollback;
