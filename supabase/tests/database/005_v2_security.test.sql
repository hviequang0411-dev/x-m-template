-- v2 security: bots, waiting members, admin, points (R34–R38).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- 1. New RPCs are service_role only ---------------------------------------------------------------
select ok(not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')
          and has_function_privilege('service_role', f, 'EXECUTE'), format('%s is service_role only', f))
from unnest(array[
  'public.add_bot(uuid, uuid, uuid)', 'public.remove_bot(uuid, uuid, uuid)', 'public.idle_bot()',
  'public.promote_waiting(uuid)', 'public.admin_list_users(uuid, text, int)',
  'public.admin_adjust_points(uuid, uuid, int, text)', 'public.admin_set_locked(uuid, uuid, boolean)'
]) f;
-- 7 tests

-- 2. Flags and balance are not client-writable; the adjustment log is closed to client writes -----
select ok(not has_column_privilege('authenticated', 'public.profiles', c, 'UPDATE'), format('profiles.%s is not writable', c))
from unnest(array['is_admin', 'is_locked', 'is_bot', 'total_score']) c;
-- 4 tests
select ok(not has_table_privilege('authenticated', 'public.point_adjustments', op), format('no %s on point_adjustments', op))
from unnest(array['INSERT', 'UPDATE', 'DELETE']) op;
-- 3 tests

-- 3. Defaults and constraints ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('f0000001-0000-0000-0000-000000000000', 'v2a@test.local', '{"username":"v2_admin"}', 'authenticated', 'authenticated'),
  ('f0000002-0000-0000-0000-000000000000', 'v2b@test.local', '{"username":"v2_user"}', 'authenticated', 'authenticated');
select is((select total_score from public.profiles where id = 'f0000002-0000-0000-0000-000000000000'), 10,
  'new accounts start with 10 points [R34]');
select throws_ok($$ update public.profiles set total_score = -1 where id = 'f0000002-0000-0000-0000-000000000000' $$,
  '23514', null, 'a balance can never be negative [R35]');

-- 4. Admin RPCs check the caller --------------------------------------------------------------
select throws_ok($$ select public.admin_list_users('f0000002-0000-0000-0000-000000000000') $$,
  'P0001', 'NOT_ADMIN', 'a non-admin cannot list users');
update public.profiles set is_admin = true where id = 'f0000001-0000-0000-0000-000000000000';
select ok(jsonb_array_length(public.admin_list_users('f0000001-0000-0000-0000-000000000000', 'v2_user')) = 1,
  'an admin can search users');
select is((public.admin_adjust_points('f0000001-0000-0000-0000-000000000000', 'f0000002-0000-0000-0000-000000000000', 5, 'beta bonus') ->> 'balance')::int,
  15, 'an admin can add points');
select throws_ok($$ select public.admin_adjust_points('f0000001-0000-0000-0000-000000000000', 'f0000002-0000-0000-0000-000000000000', -16, 'too much') $$,
  'P0001', 'BALANCE_NEGATIVE', 'points cannot go below zero');
select is((select count(*)::int from public.point_adjustments where user_id = 'f0000002-0000-0000-0000-000000000000'), 1,
  'each adjustment is logged once');

-- 5. Locked accounts are refused; an admin can't lock themselves ---------------------------------
select lives_ok($$ select public.admin_set_locked('f0000001-0000-0000-0000-000000000000', 'f0000002-0000-0000-0000-000000000000', true) $$,
  'an admin can lock an account');
select throws_ok($$ select public.create_room('f0000002-0000-0000-0000-000000000000') $$,
  'P0001', 'ACCOUNT_LOCKED', 'a locked account cannot create a room');
select throws_ok($$ select public.admin_set_locked('f0000001-0000-0000-0000-000000000000', 'f0000001-0000-0000-0000-000000000000', true) $$,
  'P0001', 'INVALID_REQUEST', 'an admin cannot lock themselves');

-- 6. Only admins read the adjustment log -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"f0000002-0000-0000-0000-000000000000","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.point_adjustments), 0, 'a player cannot read the adjustment log');
select set_config('request.jwt.claims', '{"sub":"f0000001-0000-0000-0000-000000000000","role":"authenticated"}', true);
select is((select count(*)::int from public.point_adjustments where user_id = 'f0000002-0000-0000-0000-000000000000'), 1, 'an admin can read the adjustment log');
reset role;

select * from finish();
rollback;
