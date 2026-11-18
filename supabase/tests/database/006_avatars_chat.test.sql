-- Avatars and room chat (migration 0015): who may write what, membership checks, length and
-- emote validation, the rate limit, and the realtime broadcast.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- 1. Privileges -----------------------------------------------------------------------------------
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_id', 'UPDATE'), 'profiles.avatar_id is writable by its owner');
select ok(not has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE'), format('profiles.%s is still not writable', c))
from unnest(array['total_score', 'is_admin', 'is_bot']) c;
-- 3 tests
select ok(not has_table_privilege('authenticated', 'public.room_messages', op), format('no %s on room_messages', op))
from unnest(array['INSERT', 'UPDATE', 'DELETE']) op;
-- 3 tests
select ok(not has_table_privilege('anon', 'public.room_messages', 'SELECT'), 'anon cannot read room_messages');
select ok(not has_function_privilege('anon', 'public.send_room_message(uuid, text, text)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.send_room_message(uuid, text, text)', 'EXECUTE'),
  'send_room_message is for signed-in users only');

-- Fixtures: A hosts a room, B joins it, C is elsewhere, D joins later --------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('c1000001-0000-0000-0000-000000000000', 'chata@test.local', '{"username":"chat_a"}', 'authenticated', 'authenticated'),
  ('c1000002-0000-0000-0000-000000000000', 'chatb@test.local', '{"username":"chat_b"}', 'authenticated', 'authenticated'),
  ('c1000003-0000-0000-0000-000000000000', 'chatc@test.local', '{"username":"chat_c"}', 'authenticated', 'authenticated'),
  ('c1000004-0000-0000-0000-000000000000', 'chatd@test.local', '{"username":"chat_d"}', 'authenticated', 'authenticated');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids select 'room', (public.create_room('c1000001-0000-0000-0000-000000000000') ->> 'roomId')::uuid;
select public.join_room('c1000002-0000-0000-0000-000000000000',
  (select code from public.game_rooms where id = (select v from ids where k = 'room')));

-- 2. Avatars ------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c1000001-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set avatar_id = 'fox' where id = 'c1000001-0000-0000-0000-000000000000';
select is((select avatar_id from public.profiles where id = 'c1000001-0000-0000-0000-000000000000'), 'fox', 'a player can pick an avatar');
select throws_ok($$ update public.profiles set avatar_id = 'not-an-avatar' where id = 'c1000001-0000-0000-0000-000000000000' $$,
  '23514', null, 'only built-in avatars are accepted');
update public.profiles set avatar_id = 'cat' where id = 'c1000002-0000-0000-0000-000000000000';
reset role;
select is((select avatar_id from public.profiles where id = 'c1000002-0000-0000-0000-000000000000'), null, 'a player cannot change someone else''s avatar');

-- 3. Sending: validation ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c1000001-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select is((public.send_room_message((select v from ids where k = 'room'), 'TEXT', 'xin chào') ->> 'body'), 'xin chào', 'a member can send a message');
select is((public.send_room_message((select v from ids where k = 'room'), 'TEXT', E'  nhanh\n\t lên  ') ->> 'body'), 'nhanh lên',
  'whitespace and control characters are collapsed and trimmed');
select is((public.send_room_message((select v from ids where k = 'room'), 'TEXT', repeat('a', 200)) ->> 'body'), repeat('a', 200),
  '200 characters are allowed');
select throws_ok(format($$ select public.send_room_message(%L, 'TEXT', %L) $$, (select v from ids where k = 'room'), repeat('a', 201)),
  'P0001', 'INVALID_MESSAGE', 'more than 200 characters are refused');
select throws_ok(format($$ select public.send_room_message(%L, 'TEXT', E' \n ') $$, (select v from ids where k = 'room')),
  'P0001', 'INVALID_MESSAGE', 'a blank message is refused');
select throws_ok(format($$ select public.send_room_message(%L, 'EMOTE', 'dance') $$, (select v from ids where k = 'room')),
  'P0001', 'INVALID_MESSAGE', 'an unknown emote is refused');
select throws_ok(format($$ select public.send_room_message(%L, 'IMAGE', 'x') $$, (select v from ids where k = 'room')),
  'P0001', 'INVALID_MESSAGE', 'an unknown kind is refused');
select is((public.send_room_message((select v from ids where k = 'room'), 'EMOTE', 'hurry') ->> 'kind'), 'EMOTE', 'a member can send an emote');

-- 4. Rate limit: 5 per 10 seconds (the 4 above + 1 more) ---------------------------------------------
select lives_ok(format($$ select public.send_room_message(%L, 'EMOTE', 'nice') $$, (select v from ids where k = 'room')),
  'the 5th message in the window is accepted');
select throws_ok(format($$ select public.send_room_message(%L, 'TEXT', 'spam') $$, (select v from ids where k = 'room')),
  'P0001', 'RATE_LIMITED', 'the 6th message in the window is refused');

-- 5. No direct writes -------------------------------------------------------------------------------
select throws_ok(format($$ insert into public.room_messages (room_id, user_id, kind, body) values (%L, 'c1000001-0000-0000-0000-000000000000', 'TEXT', 'x') $$,
  (select v from ids where k = 'room')), '42501', null, 'clients cannot insert chat rows directly');
select throws_ok($$ delete from public.room_messages $$, '42501', null, 'clients cannot delete chat rows');

-- 6. Reading: members only, and only since they joined -----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c1000002-0000-0000-0000-000000000000","role":"authenticated"}', true);
select is((select count(*)::int from public.room_messages where room_id = (select v from ids where k = 'room')), 5,
  'another member reads the room''s messages');
select set_config('request.jwt.claims', '{"sub":"c1000003-0000-0000-0000-000000000000","role":"authenticated"}', true);
select is((select count(*)::int from public.room_messages), 0, 'an outsider reads nothing');
select throws_ok(format($$ select public.send_room_message(%L, 'TEXT', 'hello') $$, (select v from ids where k = 'room')),
  'P0001', 'NOT_ROOM_MEMBER', 'an outsider cannot send');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(format($$ select public.send_room_message(%L, 'TEXT', 'hello') $$, (select v from ids where k = 'room')),
  'P0001', 'NOT_AUTHENTICATED', 'a call without a user is refused');
reset role;

-- D joins after the messages were sent (pretend a second later: now() is fixed in a transaction).
select public.join_room('c1000004-0000-0000-0000-000000000000',
  (select code from public.game_rooms where id = (select v from ids where k = 'room')));
update public.room_players set joined_at = now() + interval '1 second'
where user_id = 'c1000004-0000-0000-0000-000000000000';
select set_config('request.jwt.claims', '{"sub":"c1000004-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.room_messages), 0, 'a newcomer does not see what was said before they joined');
reset role;

-- 7. Locked accounts and former members ---------------------------------------------------------------
update public.profiles set is_locked = true where id = 'c1000002-0000-0000-0000-000000000000';
select set_config('request.jwt.claims', '{"sub":"c1000002-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format($$ select public.send_room_message(%L, 'TEXT', 'hello') $$, (select v from ids where k = 'room')),
  'P0001', 'ACCOUNT_LOCKED', 'a locked account cannot chat');
reset role;

select public.leave_room('c1000001-0000-0000-0000-000000000000', (select v from ids where k = 'room'));
select set_config('request.jwt.claims', '{"sub":"c1000001-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.room_messages), 0, 'after leaving, a player no longer reads the room''s chat');
reset role;

-- 8. Broadcast and stored rows ---------------------------------------------------------------------
select is((select count(*)::int from realtime.messages
           where topic = 'room:' || (select v from ids where k = 'room') and event = 'chat' and private),
  5, 'every accepted message is broadcast privately on the room topic');
select is((select payload ->> 'displayName' from realtime.messages
           where topic = 'room:' || (select v from ids where k = 'room') and event = 'chat' limit 1),
  'chat_a', 'the broadcast carries the sender''s display name');
select ok((select bool_and(user_id = 'c1000001-0000-0000-0000-000000000000') from public.room_messages
           where room_id = (select v from ids where k = 'room')), 'messages are stored under the caller, never a client-chosen user');

select * from finish();
rollback;
