-- 0005 · game RPCs: start_match, apply_game_action, match_public_state
-- The Edge Function shuffles/deals and runs the TypeScript engine; these RPCs re-check what
-- matters under a row lock and commit atomically. Called only with the service role.

-- What every seat may see (no hands). Broadcast on match:<id> and returned to callers.
create or replace function public.match_public_state(p_match uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'matchId', m.id,
    'roomId', m.room_id,
    'version', m.version,
    'status', m.status,
    'currentSeat', m.current_seat,
    'leadSeat', m.lead_seat,
    'currentTrick', m.current_trick,
    'passedSeats', to_jsonb(m.passed_seats),
    'winnerSeat', m.winner_seat,
    'turnDeadline', m.turn_deadline,
    'seats', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'seat', mp.seat, 'userId', mp.user_id, 'cardCount', mp.card_count,
        'hasPlayed', mp.has_played, 'status', mp.status) order by mp.seat), '[]'::jsonb)
      from public.match_players mp where mp.match_id = m.id
    )
  )
  from public.matches m
  where m.id = p_match;
$$;

create or replace function public.start_match(p_user uuid, p_room uuid, p_hands jsonb, p_first_seat smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room      public.game_rooms%rowtype;
  v_hand_size int;
  v_match     uuid;
  v_match_no  int;
  v_all       text[] := '{}';
  v_hand      text[];
  v_player    record;
begin
  select * into v_room from public.game_rooms where id = p_room for update;
  if not found or v_room.status = 'CLOSED' then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.room_players where room_id = p_room and user_id = p_user and status = 'ACTIVE') then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;
  if v_room.host_id <> p_user then
    raise exception 'NOT_ROOM_HOST' using errcode = 'P0001';
  end if;
  if v_room.status <> 'WAITING' then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;
  if (select count(*) from public.room_players where room_id = p_room and status = 'ACTIVE') <> 4 then
    raise exception 'NOT_ENOUGH_PLAYERS' using errcode = 'P0001';
  end if;

  -- Validate the deal: 4 hands of handSize valid cards, 4×handSize distinct cards in total.
  select (config ->> 'handSize')::int into v_hand_size from public.game_rulesets where id = v_room.ruleset_id;
  if jsonb_typeof(p_hands) <> 'array' or jsonb_array_length(p_hands) <> 4 then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  for i in 0..3 loop
    if jsonb_typeof(p_hands -> i) <> 'array' then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    v_hand := array(select jsonb_array_elements_text(p_hands -> i));
    if cardinality(v_hand) <> v_hand_size or not public.is_valid_card_array(v_hand) then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    v_all := v_all || v_hand;
  end loop;
  if not public.is_valid_card_array(v_all) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  -- First match: any seat (the function picks it with crypto RNG) [R13]. Later: previous winner [R14].
  if p_first_seat is null or p_first_seat not between 0 and 3
     or (v_room.last_winner_seat is not null and p_first_seat <> v_room.last_winner_seat) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select coalesce(max(match_no), 0) + 1 into v_match_no from public.matches where room_id = p_room;

  insert into public.matches (room_id, ruleset_id, match_no, version, current_seat, lead_seat, turn_deadline)
  values (p_room, v_room.ruleset_id, v_match_no, 1, p_first_seat, p_first_seat,
          now() + make_interval(secs => (select (config ->> 'turnTimeoutSeconds')::int
                                         from public.game_rulesets where id = v_room.ruleset_id)))
  returning id into v_match;

  for v_player in
    select user_id, seat from public.room_players where room_id = p_room and status = 'ACTIVE' order by seat
  loop
    v_hand := array(select jsonb_array_elements_text(p_hands -> v_player.seat::int));
    insert into public.match_players (match_id, user_id, seat, card_count)
    values (v_match, v_player.user_id, v_player.seat, cardinality(v_hand));
    insert into public.player_private_states (match_id, user_id, hand)
    values (v_match, v_player.user_id, v_hand);
  end loop;

  insert into public.game_actions (match_id, action_id, user_id, action_type, version_after)
  values (v_match, gen_random_uuid(), p_user, 'DEAL', 1);

  update public.game_rooms set status = 'PLAYING', current_match_id = v_match where id = p_room;

  perform public.notify_room(p_room, 'match_started', jsonb_build_object('matchId', v_match));
  return public.match_public_state(v_match);
end;
$$;

-- ARCHITECTURE §4 step 7. p_next is the engine's next public state:
-- { status, currentSeat, leadSeat, currentTrick, passedSeats, winnerSeat, combination }.
create or replace function public.apply_game_action(
  p_match uuid,
  p_action_id uuid,
  p_user uuid,
  p_expected_version bigint,
  p_action_type text,
  p_cards text[],
  p_next jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match    public.matches%rowtype;
  v_seat     smallint;
  v_hand     text[];
  v_new_hand text[];
  v_status   text := p_next ->> 'status';
  v_winner   smallint := (p_next ->> 'winnerSeat')::smallint;
  v_next     smallint := (p_next ->> 'currentSeat')::smallint;
  v_lead     smallint := (p_next ->> 'leadSeat')::smallint;
  v_combo    text := p_next ->> 'combination';
  v_timeout  int;
begin
  if p_action_type not in ('PLAY', 'PASS') then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  -- The row lock serialises every action on this match.
  select * into v_match from public.matches where id = p_match for update;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.game_actions where match_id = p_match and action_id = p_action_id) then
    raise exception 'ACTION_ALREADY_PROCESSED' using errcode = 'P0001';
  end if;
  if v_match.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_match.status <> 'PLAYING' then
    raise exception 'MATCH_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  select seat into v_seat from public.match_players where match_id = p_match and user_id = p_user;
  if v_seat is null then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;
  if v_seat <> v_match.current_seat then
    raise exception 'NOT_YOUR_TURN' using errcode = 'P0001';
  end if;

  select hand into v_hand from public.player_private_states where match_id = p_match and user_id = p_user for update;

  if p_action_type = 'PLAY' then
    -- Defence in depth: the cards must really be in the stored hand.
    if p_cards is null or cardinality(p_cards) = 0 or not public.is_valid_card_array(p_cards) or v_combo is null then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    if not (v_hand @> p_cards) then
      raise exception 'CARD_NOT_OWNED' using errcode = 'P0001';
    end if;
    v_new_hand := array(select c from unnest(v_hand) c where c <> all (p_cards));
  else
    if p_cards is not null or v_combo is not null then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    v_new_hand := v_hand;
  end if;

  -- The engine and the stored hand must agree on who (if anyone) just won.
  if v_status not in ('PLAYING', 'FINISHED')
     or (cardinality(v_new_hand) = 0) <> (v_status = 'FINISHED' and v_winner = v_seat)
     or (v_status = 'PLAYING' and (v_next is null or v_next not between 0 and 3))
     or v_lead is null or v_lead not between 0 and 3 then
    raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
  end if;

  if p_action_type = 'PLAY' then
    update public.player_private_states set hand = v_new_hand where match_id = p_match and user_id = p_user;
    update public.match_players
    set card_count = cardinality(v_new_hand), has_played = true
    where match_id = p_match and user_id = p_user;
  end if;

  select (config ->> 'turnTimeoutSeconds')::int into v_timeout from public.game_rulesets where id = v_match.ruleset_id;

  update public.matches set
    version       = version + 1,
    status        = v_status,
    current_seat  = case when v_status = 'PLAYING' then v_next else current_seat end,
    lead_seat     = v_lead,
    current_trick = case when jsonb_typeof(p_next -> 'currentTrick') = 'object' then p_next -> 'currentTrick' end,
    passed_seats  = array(select jsonb_array_elements_text(coalesce(p_next -> 'passedSeats', '[]'))::smallint),
    winner_seat   = v_winner,
    turn_deadline = case when v_status = 'PLAYING' then now() + make_interval(secs => v_timeout) end,
    finished_at   = case when v_status = 'FINISHED' then now() end
  where id = p_match;

  insert into public.game_actions (match_id, action_id, user_id, seat, action_type, cards, combination, version_after)
  values (p_match, p_action_id, p_user, v_seat, p_action_type,
          case when p_action_type = 'PLAY' then p_cards end, v_combo, v_match.version + 1);

  if v_status = 'FINISHED' then
    update public.match_players
    set status = case when seat = v_winner then 'WON' else 'LOST' end
    where match_id = p_match;
    update public.game_rooms
    set status = 'WAITING', last_winner_seat = v_winner
    where id = v_match.room_id;
    -- Scores and match_results are written here on Day 6 (T6.1).
    perform public.notify_room(v_match.room_id, 'match_finished', jsonb_build_object('matchId', p_match));
  end if;

  -- Delivered only after commit. Public data only: never hands.
  perform realtime.send(public.match_public_state(p_match), 'state', 'match:' || p_match, true);

  return public.match_public_state(p_match);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.match_public_state(uuid)',
    'public.start_match(uuid, uuid, jsonb, smallint)',
    'public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
