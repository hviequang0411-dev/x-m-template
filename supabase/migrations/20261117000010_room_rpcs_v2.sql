-- 0010 · room RPCs v2: waiting members [R37], bots [R36], locked accounts [R38], 2–4 seats [R01b]
-- Replaces create_room / join_room / leave_room from 0004 (same signatures) and adds
-- promote_waiting, add_bot, remove_bot, idle_bot. Service-role only, like every RPC.

-- A room seats up to max_players (4) PLAYERs; anyone else who joins waits. Cap on members in total:
create or replace function public.room_member_cap() returns int language sql immutable as $$ select 8 $$;

create or replace function public.assert_not_locked(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = p_user and is_locked) then
    raise exception 'ACCOUNT_LOCKED' using errcode = 'P0001';
  end if;
end;
$$;

-- Lowest free seat in a room, or null when all max_players seats are taken.
create or replace function public.free_seat(p_room uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select min(s)::smallint
  from public.game_rooms r, generate_series(0, r.max_players - 1) s
  where r.id = p_room
    and not exists (
      select 1 from public.room_players rp
      where rp.room_id = p_room and rp.status = 'ACTIVE' and rp.seat = s
    );
$$;

-- Moves waiting members into free seats, in join order. Only while the room is WAITING
-- (never mid-match). Returns how many moved.
create or replace function public.promote_waiting(p_room uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat  smallint;
  v_id    uuid;
  v_moved int := 0;
begin
  if (select status from public.game_rooms where id = p_room) <> 'WAITING' then
    return 0;
  end if;
  loop
    v_seat := public.free_seat(p_room);
    exit when v_seat is null;
    select id into v_id
    from public.room_players
    where room_id = p_room and status = 'ACTIVE' and role = 'WAITING'
    order by joined_at, id
    limit 1;
    exit when v_id is null;
    update public.room_players set role = 'PLAYER', seat = v_seat where id = v_id;
    v_moved := v_moved + 1;
  end loop;
  if v_moved > 0 then
    perform public.notify_room(p_room, 'players_changed');
  end if;
  return v_moved;
end;
$$;

create or replace function public.create_room(p_user uuid, p_ruleset_code text default 'xam-baseline')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset uuid;
  v_room    uuid;
  v_code    text;
begin
  perform public.assert_not_locked(p_user);
  if exists (select 1 from public.room_players where user_id = p_user and status = 'ACTIVE') then
    raise exception 'ALREADY_IN_ROOM' using errcode = 'P0001';
  end if;

  select id into v_ruleset
  from public.game_rulesets
  where code = p_ruleset_code and status = 'APPROVED'
  order by version desc
  limit 1;
  if v_ruleset is null then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  for i in 1..10 loop
    v_code := public.generate_room_code();
    begin
      insert into public.game_rooms (code, host_id, ruleset_id)
      values (v_code, p_user, v_ruleset)
      returning id into v_room;
      exit;
    exception when unique_violation then
      if i = 10 then raise; end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, seat, role) values (v_room, p_user, 0, 'PLAYER');
  return jsonb_build_object('roomId', v_room, 'code', v_code, 'seat', 0, 'role', 'PLAYER');
end;
$$;

-- Joins by code. Takes the lowest free seat while the room is WAITING; otherwise (match in progress,
-- or 4 seats taken) joins as WAITING and gets a seat later [R37].
create or replace function public.join_room(p_user uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_seat smallint;
  v_role text;
begin
  perform public.assert_not_locked(p_user);
  select * into v_room
  from public.game_rooms
  where code = upper(btrim(p_code)) and status <> 'CLOSED'
  for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.room_players where user_id = p_user and status = 'ACTIVE') then
    raise exception 'ALREADY_IN_ROOM' using errcode = 'P0001';
  end if;
  if (select count(*) from public.room_players where room_id = v_room.id and status = 'ACTIVE') >= public.room_member_cap() then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  v_seat := case when v_room.status = 'WAITING' then public.free_seat(v_room.id) end;
  v_role := case when v_seat is null then 'WAITING' else 'PLAYER' end;
  insert into public.room_players (room_id, user_id, seat, role) values (v_room.id, p_user, v_seat, v_role);
  perform public.notify_room(v_room.id, 'players_changed');

  return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'seat', v_seat, 'role', v_role);
end;
$$;

-- Leaving is refused only for someone seated in the match being played (R29 is not implemented);
-- waiting members may leave any time. Host leaves → the lowest-seated HUMAN player (after promoting
-- waiting members) becomes host; with no human left the room closes and its bots leave [R33].
create or replace function public.leave_room(p_user uuid, p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room     public.game_rooms%rowtype;
  v_new_host uuid;
begin
  select * into v_room from public.game_rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room and user_id = p_user and status = 'ACTIVE') then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;
  if v_room.status = 'PLAYING' and exists (
    select 1 from public.match_players mp
    where mp.match_id = v_room.current_match_id and mp.user_id = p_user
  ) then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;

  update public.room_players set status = 'LEFT', left_at = now(), seat = null, role = 'WAITING'
  where room_id = p_room and user_id = p_user and status = 'ACTIVE';
  perform public.promote_waiting(p_room);

  if v_room.host_id = p_user then
    select rp.user_id into v_new_host
    from public.room_players rp
    join public.profiles p on p.id = rp.user_id
    where rp.room_id = p_room and rp.status = 'ACTIVE' and not p.is_bot
    order by (rp.role = 'PLAYER') desc, rp.seat nulls last, rp.joined_at
    limit 1;
    if v_new_host is null then
      update public.room_players set status = 'LEFT', left_at = now(), seat = null, role = 'WAITING'
      where room_id = p_room and status = 'ACTIVE';
      if v_room.status = 'WAITING' then
        update public.game_rooms set status = 'CLOSED', closed_at = now() where id = p_room;
      end if;
    else
      update public.game_rooms set host_id = v_new_host where id = p_room;
    end if;
  end if;

  perform public.notify_room(p_room, 'players_changed');
  return jsonb_build_object('roomId', p_room, 'left', true);
end;
$$;

-- An idle bot account (not in any room), or null. The function creates one when null.
create or replace function public.idle_bot()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.is_bot
    and not exists (select 1 from public.room_players rp where rp.user_id = p.id and rp.status = 'ACTIVE')
  order by p.created_at
  limit 1;
$$;

-- Host adds a bot to the lowest free seat [R36]. A concurrent add of the same bot elsewhere hits
-- the one-active-room unique index; the function then retries with another bot.
create or replace function public.add_bot(p_user uuid, p_room uuid, p_bot uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
  v_seat smallint;
begin
  select * into v_room from public.game_rooms where id = p_room for update;
  if not found or v_room.status = 'CLOSED' then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_room.host_id <> p_user then
    raise exception 'NOT_ROOM_HOST' using errcode = 'P0001';
  end if;
  if v_room.status <> 'WAITING' then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_bot and is_bot) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  v_seat := public.free_seat(p_room);
  if v_seat is null then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;
  insert into public.room_players (room_id, user_id, seat, role) values (p_room, p_bot, v_seat, 'PLAYER');
  perform public.notify_room(p_room, 'players_changed');
  return jsonb_build_object('roomId', p_room, 'botId', p_bot, 'seat', v_seat);
end;
$$;

create or replace function public.remove_bot(p_user uuid, p_room uuid, p_bot uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.game_rooms%rowtype;
begin
  select * into v_room from public.game_rooms where id = p_room for update;
  if not found or v_room.status = 'CLOSED' then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_room.host_id <> p_user then
    raise exception 'NOT_ROOM_HOST' using errcode = 'P0001';
  end if;
  if v_room.status <> 'WAITING' then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;
  update public.room_players rp set status = 'LEFT', left_at = now(), seat = null, role = 'WAITING'
  from public.profiles p
  where rp.room_id = p_room and rp.user_id = p_bot and rp.status = 'ACTIVE' and p.id = rp.user_id and p.is_bot;
  if not found then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  perform public.promote_waiting(p_room);
  perform public.notify_room(p_room, 'players_changed');
  return jsonb_build_object('roomId', p_room, 'botId', p_bot, 'removed', true);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.room_member_cap()', 'public.assert_not_locked(uuid)', 'public.free_seat(uuid)',
    'public.promote_waiting(uuid)', 'public.create_room(uuid, text)', 'public.join_room(uuid, text)',
    'public.leave_room(uuid, uuid)', 'public.idle_bot()', 'public.add_bot(uuid, uuid, uuid)',
    'public.remove_bot(uuid, uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
