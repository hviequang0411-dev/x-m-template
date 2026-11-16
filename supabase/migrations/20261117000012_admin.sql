-- 0012 · admin RPCs [R38]. Admins are marked with profiles.is_admin, set by SQL only:
--   update public.profiles set is_admin = true where username = '<your username>';
-- Called by the admin-* Edge Functions with the service role; each checks that p_admin is an admin.

create or replace function public.assert_admin(p_admin uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_admin and is_admin and not is_locked) then
    raise exception 'NOT_ADMIN' using errcode = 'P0001';
  end if;
end;
$$;

-- Human accounts (bots excluded), newest first, filtered by username / display name / email.
create or replace function public.admin_list_users(p_admin uuid, p_query text default '', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := '%' || lower(btrim(coalesce(p_query, ''))) || '%';
begin
  perform public.assert_admin(p_admin);
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select p.id, p.username, p.display_name, u.email::text as email, p.total_score, p.matches_played,
             p.matches_won, p.is_admin, p.is_locked, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
      where not p.is_bot
        and (lower(p.username) like v_q or lower(p.display_name) like v_q or lower(u.email) like v_q)
      order by p.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Adds (or with a negative delta removes) points, logged with a reason. Never below 0 [R35].
-- Points have no monetary value [R22]: this is for test/beta balances, not for selling points.
create or replace function public.admin_adjust_points(p_admin uuid, p_user uuid, p_delta int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance int;
begin
  perform public.assert_admin(p_admin);
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000
     or p_reason is null or char_length(btrim(p_reason)) not between 3 and 200 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  select total_score into v_balance from public.profiles where id = p_user and not is_bot for update;
  if not found then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if v_balance + p_delta < 0 then
    raise exception 'BALANCE_NEGATIVE' using errcode = 'P0001';
  end if;
  update public.profiles set total_score = v_balance + p_delta where id = p_user;
  insert into public.point_adjustments (user_id, admin_id, delta, reason, balance_after)
  values (p_user, p_admin, p_delta, btrim(p_reason), v_balance + p_delta);
  return jsonb_build_object('userId', p_user, 'balance', v_balance + p_delta);
end;
$$;

-- Locked accounts can't create, join or start (assert_not_locked in the room/game RPCs).
create or replace function public.admin_set_locked(p_admin uuid, p_user uuid, p_locked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin(p_admin);
  if p_user = p_admin or p_locked is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  update public.profiles set is_locked = p_locked where id = p_user and not is_bot;
  if not found then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  return jsonb_build_object('userId', p_user, 'locked', p_locked);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.assert_admin(uuid)', 'public.admin_list_users(uuid, text, int)',
    'public.admin_adjust_points(uuid, uuid, int, text)', 'public.admin_set_locked(uuid, uuid, boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
