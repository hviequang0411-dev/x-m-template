-- 0015 · avatars, room chat and emotes
-- * profiles.avatar_id: one of the built-in avatars drawn in the app (src/features/avatars). Null
--   means "no avatar picked" (the app shows the initial). Bots never store one: the app derives a
--   robot avatar from the bot's id. The list below must match USER_AVATAR_IDS in the app.
-- * room_messages: chat lines and emotes of a room. Members read them through RLS; nobody inserts
--   directly. send_room_message() checks membership, length and a rate limit, stores the row and
--   broadcasts it on the existing private topic room:<roomId> (event "chat"), which only active
--   members can receive (policy realtime_members_receive, migration 0006/0009).

-- ---------------------------------------------------------------------------
-- profiles.avatar_id
-- ---------------------------------------------------------------------------
alter table public.profiles add column avatar_id text;
alter table public.profiles add constraint profiles_avatar_id_valid check (
  avatar_id is null or avatar_id in (
    'ace', 'queen', 'dealer', 'lucky', 'shades', 'bun',
    'cap', 'scholar', 'cat', 'fox', 'panda', 'tiger'
  )
);
-- Column grant (0001 allowed display_name and avatar_url): owners may also pick an avatar.
grant update (avatar_id) on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- room_messages
-- ---------------------------------------------------------------------------
create table public.room_messages (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.game_rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('TEXT', 'EMOTE')),
  body       text not null,
  created_at timestamptz not null default now(),
  constraint room_messages_body_valid check (
    (kind = 'TEXT' and char_length(body) between 1 and 200 and body = btrim(body))
    or (kind = 'EMOTE' and body in ('happy', 'laugh', 'sad', 'angry', 'wow', 'hurry', 'nice', 'gg'))
  )
);
create index room_messages_room_idx on public.room_messages (room_id, id desc);
create index room_messages_user_idx on public.room_messages (user_id, created_at desc);

-- Can the CALLER read a message of this room sent at this time? Active members only, and only
-- messages sent since they joined (a newcomer does not see what was said before).
create or replace function public.can_read_room_message(p_room_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players rp
    where rp.room_id = p_room_id
      and rp.user_id = (select auth.uid())
      and rp.status = 'ACTIVE'
      and rp.joined_at <= p_created_at
  );
$$;
revoke all on function public.can_read_room_message(uuid, timestamptz) from public, anon;
grant execute on function public.can_read_room_message(uuid, timestamptz) to authenticated, service_role;

alter table public.room_messages enable row level security;
revoke all on table public.room_messages from anon, authenticated;
grant all on table public.room_messages to service_role;
grant select on table public.room_messages to authenticated;

create policy room_messages_select_members
  on public.room_messages for select to authenticated
  using (public.can_read_room_message(room_id, created_at));

-- Rate limit: at most chat_rate_max() messages (text + emotes) per user in chat_rate_window().
create or replace function public.chat_rate_max() returns int language sql immutable as $$ select 5 $$;
create or replace function public.chat_rate_window() returns interval language sql immutable as $$ select interval '10 seconds' $$;

-- Send a chat line (p_kind 'TEXT') or an emote (p_kind 'EMOTE', p_body = emote code) as the caller.
-- Errors (P0001): NOT_AUTHENTICATED, INVALID_MESSAGE, NOT_ROOM_MEMBER, ACCOUNT_LOCKED, RATE_LIMITED.
create or replace function public.send_room_message(p_room uuid, p_kind text, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_body text;
  v_name text;
  v_row  public.room_messages;
  v_msg  jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if p_kind = 'TEXT' then
    -- Control characters (newlines, tabs, …) become spaces; runs of spaces collapse.
    v_body := btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
    if char_length(v_body) not between 1 and 200 then
      raise exception 'INVALID_MESSAGE' using errcode = 'P0001';
    end if;
  elsif p_kind = 'EMOTE' then
    v_body := p_body;
    if v_body is null or v_body not in ('happy', 'laugh', 'sad', 'angry', 'wow', 'hurry', 'nice', 'gg') then
      raise exception 'INVALID_MESSAGE' using errcode = 'P0001';
    end if;
  else
    raise exception 'INVALID_MESSAGE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.room_players
    where room_id = p_room and user_id = v_uid and status = 'ACTIVE'
  ) then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;
  perform public.assert_not_locked(v_uid);

  -- Serialize one user's sends so parallel calls cannot slip past the rate limit together.
  perform pg_advisory_xact_lock(hashtextextended('room_messages:' || v_uid::text, 0));
  if (select count(*) from public.room_messages
      where user_id = v_uid and created_at > now() - public.chat_rate_window()) >= public.chat_rate_max() then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.room_messages (room_id, user_id, kind, body)
  values (p_room, v_uid, p_kind, v_body)
  returning * into v_row;

  -- Keep the table small: a room's chat older than a day is no longer useful.
  delete from public.room_messages where room_id = p_room and created_at < now() - interval '1 day';

  select display_name into v_name from public.profiles where id = v_uid;
  v_msg := jsonb_build_object(
    'id', v_row.id, 'roomId', v_row.room_id, 'userId', v_row.user_id, 'displayName', v_name,
    'kind', v_row.kind, 'body', v_row.body, 'createdAt', v_row.created_at);
  perform realtime.send(v_msg, 'chat', 'room:' || p_room, true);
  return v_msg;
end;
$$;

revoke all on function public.send_room_message(uuid, text, text) from public, anon;
grant execute on function public.send_room_message(uuid, text, text) to authenticated, service_role;
revoke all on function public.chat_rate_max() from public, anon;
revoke all on function public.chat_rate_window() from public, anon;
grant execute on function public.chat_rate_max() to authenticated, service_role;
grant execute on function public.chat_rate_window() to authenticated, service_role;
