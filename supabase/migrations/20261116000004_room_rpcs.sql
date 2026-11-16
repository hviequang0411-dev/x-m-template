-- 0004 · room RPCs: create_room, join_room, leave_room
-- Called only by Edge Functions with the service role. Errors are raised as
-- P0001 with the error code as the message; the function maps them to the envelope.

-- Room events go to the private Realtime topic room:<id>. Members re-fetch on any event,
-- so the payload carries no private data.
create or replace function public.notify_room(p_room uuid, p_event text, p_payload jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload || jsonb_build_object('roomId', p_room), p_event, 'room:' || p_room, true);
end;
$$;

-- 6 characters from an alphabet without 0/O/1/I (matches the game_rooms.code check).
create or replace function public.generate_room_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
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

  -- Retry on the (unlikely) code collision.
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

  -- The partial unique index room_players_one_active_room_key closes the race with a
  -- concurrent create/join by the same user (mapped to ALREADY_IN_ROOM by the function).
  insert into public.room_players (room_id, user_id, seat) values (v_room, p_user, 0);

  return jsonb_build_object('roomId', v_room, 'code', v_code, 'seat', 0);
end;
$$;

create or replace function public.join_room(p_user uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room   public.game_rooms%rowtype;
  v_count  int;
  v_seat   smallint;
begin
  select * into v_room
  from public.game_rooms
  where code = upper(trim(p_code)) and status <> 'CLOSED'
  for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.room_players where user_id = p_user and status = 'ACTIVE') then
    raise exception 'ALREADY_IN_ROOM' using errcode = 'P0001';
  end if;
  if v_room.status = 'PLAYING' then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.room_players where room_id = v_room.id and status = 'ACTIVE';
  if v_count >= v_room.max_players then
    raise exception 'ROOM_FULL' using errcode = 'P0001';
  end if;

  select min(s)::smallint into v_seat
  from generate_series(0, v_room.max_players - 1) s
  where not exists (
    select 1 from public.room_players rp
    where rp.room_id = v_room.id and rp.status = 'ACTIVE' and rp.seat = s
  );

  insert into public.room_players (room_id, user_id, seat) values (v_room.id, p_user, v_seat);
  perform public.notify_room(v_room.id, 'players_changed');

  return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'seat', v_seat);
end;
$$;

-- Leaving is allowed only while the room is WAITING (leaving mid-match is a forfeit, Day 6 / R29).
-- Host leaves → the lowest occupied seat becomes host; last one out → room CLOSED [R33].
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
  if not exists (
    select 1 from public.room_players where room_id = p_room and user_id = p_user and status = 'ACTIVE'
  ) then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;
  if v_room.status = 'PLAYING' then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;

  update public.room_players set status = 'LEFT', left_at = now()
  where room_id = p_room and user_id = p_user and status = 'ACTIVE';

  if v_room.host_id = p_user then
    select user_id into v_new_host
    from public.room_players
    where room_id = p_room and status = 'ACTIVE'
    order by seat
    limit 1;
    if v_new_host is null then
      update public.game_rooms set status = 'CLOSED', closed_at = now() where id = p_room;
    else
      update public.game_rooms set host_id = v_new_host where id = p_room;
    end if;
  end if;

  perform public.notify_room(p_room, 'players_changed');
  return jsonb_build_object('roomId', p_room, 'left', true);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.notify_room(uuid, text, jsonb)',
    'public.generate_room_code()',
    'public.create_room(uuid, text)',
    'public.join_room(uuid, text)',
    'public.leave_room(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
