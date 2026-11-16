-- 0006 · Realtime authorization for private channels
-- Topics: room:<roomId> (active room members) and match:<matchId> (seated players).
-- Messages are sent by the RPCs (realtime.send); clients only receive, plus Presence on room topics.

create or replace function public.can_access_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text := split_part(p_topic, ':', 1);
  v_id   text := split_part(p_topic, ':', 2);
begin
  if v_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or p_topic <> v_kind || ':' || v_id then
    return false;
  end if;
  if v_kind = 'room' then
    return public.is_room_member(v_id::uuid);
  elsif v_kind = 'match' then
    return public.is_match_player(v_id::uuid);
  end if;
  return false;
end;
$$;

revoke all on function public.can_access_topic(text) from public, anon;
grant execute on function public.can_access_topic(text) to authenticated, service_role;

create policy realtime_members_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_access_topic((select realtime.topic()))
  );

create policy realtime_room_members_presence
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (select realtime.topic()) like 'room:%'
    and public.can_access_topic((select realtime.topic()))
  );
