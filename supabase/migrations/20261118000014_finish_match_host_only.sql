-- 0014 · Only the room host can end a running match early (it is marked ABORTED and the room returns to WAITING).
-- Replaces finish_match from 0011. Kept separate because 0013 is already applied in production.

create or replace function public.finish_match(p_user uuid, p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_host  uuid;
begin
  select * into v_match from public.matches where id = p_match for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.match_players where match_id = p_match and user_id = p_user) then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;
  select host_id into v_host from public.game_rooms where id = v_match.room_id for update;
  if v_host <> p_user then
    raise exception 'NOT_ROOM_HOST' using errcode = 'P0001';
  end if;
  if v_match.status <> 'PLAYING' then
    raise exception 'MATCH_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  update public.matches
  set status = 'ABORTED', version = version + 1, finished_at = now(), turn_deadline = null
  where id = p_match;
  insert into public.game_actions (match_id, action_id, user_id, action_type, version_after)
  values (p_match, gen_random_uuid(), p_user, 'ABORT', v_match.version + 1);
  update public.game_rooms set status = 'WAITING' where id = v_match.room_id;
  perform public.promote_waiting(v_match.room_id);

  perform public.notify_room(v_match.room_id, 'match_finished', jsonb_build_object('matchId', p_match));
  perform realtime.send(public.match_public_state(p_match), 'state', 'match:' || p_match, true);
  return public.match_public_state(p_match);
end;
$$;
