-- 0008 · apply_game_action: NULL-safe result checks
-- Found by 004_security_suite: in 0007, comparisons like `(penalties->>'cong') = 'true' <> …` are NULL
-- when a key is missing, and an IF on NULL does not raise. A results payload without the cóng flag
-- (or without isWinner / remainingCards / scoreDelta, or a FINISHED state without a winner) was
-- accepted. Every check now uses IS DISTINCT FROM and requires each field with the right JSON type.

create or replace function public.apply_game_action(
  p_match uuid,
  p_action_id uuid,
  p_user uuid,
  p_expected_version bigint,
  p_action_type text,
  p_cards text[],
  p_next jsonb,
  p_results jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match    public.matches%rowtype;
  v_config   jsonb;
  v_timeout  boolean := p_action_type in ('TIMEOUT_PASS', 'TIMEOUT_PLAY');
  v_is_play  boolean := p_action_type in ('PLAY', 'TIMEOUT_PLAY');
  v_actor    uuid;
  v_seat     smallint;
  v_hand     text[];
  v_new_hand text[];
  v_status   text := p_next ->> 'status';
  v_winner   smallint := (p_next ->> 'winnerSeat')::smallint;
  v_next     smallint := (p_next ->> 'currentSeat')::smallint;
  v_lead     smallint := (p_next ->> 'leadSeat')::smallint;
  v_combo    text := p_next ->> 'combination';
  v_res      jsonb;
  v_player   record;
  v_expected int;
  v_sum      int := 0;
begin
  if p_action_type not in ('PLAY', 'PASS', 'TIMEOUT_PASS', 'TIMEOUT_PLAY') then
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
  if not exists (select 1 from public.match_players where match_id = p_match and user_id = p_user) then
    raise exception 'NOT_ROOM_MEMBER' using errcode = 'P0001';
  end if;

  if v_timeout then
    -- Any seated player may claim, but only after the deadline (server clock) [R27].
    if v_match.turn_deadline is null or v_match.turn_deadline > now() then
      raise exception 'TURN_NOT_EXPIRED' using errcode = 'P0001';
    end if;
    select user_id, seat into v_actor, v_seat
    from public.match_players where match_id = p_match and seat = v_match.current_seat;
  else
    v_actor := p_user;
    select seat into v_seat from public.match_players where match_id = p_match and user_id = p_user;
    if v_seat <> v_match.current_seat then
      raise exception 'NOT_YOUR_TURN' using errcode = 'P0001';
    end if;
  end if;

  select config into v_config from public.game_rulesets where id = v_match.ruleset_id;
  select hand into v_hand from public.player_private_states where match_id = p_match and user_id = v_actor for update;

  if v_is_play then
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
     or (cardinality(v_new_hand) = 0) is distinct from (v_status = 'FINISHED' and v_winner is not distinct from v_seat)
     or (v_status = 'FINISHED' and v_winner is null)
     or (v_status = 'PLAYING' and v_winner is not null)
     or (v_status = 'PLAYING' and (v_next is null or v_next not between 0 and 3))
     or v_lead is null or v_lead not between 0 and 3
     or (v_status = 'FINISHED') <> (p_results is not null) then
    raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
  end if;

  if v_is_play then
    update public.player_private_states set hand = v_new_hand where match_id = p_match and user_id = v_actor;
    update public.match_players
    set card_count = cardinality(v_new_hand), has_played = true
    where match_id = p_match and user_id = v_actor;
  end if;

  update public.matches set
    version       = version + 1,
    status        = v_status,
    current_seat  = case when v_status = 'PLAYING' then v_next else current_seat end,
    lead_seat     = v_lead,
    current_trick = case when jsonb_typeof(p_next -> 'currentTrick') = 'object' then p_next -> 'currentTrick' end,
    passed_seats  = array(select jsonb_array_elements_text(coalesce(p_next -> 'passedSeats', '[]'))::smallint),
    winner_seat   = v_winner,
    turn_deadline = case when v_status = 'PLAYING'
                         then now() + make_interval(secs => (v_config ->> 'turnTimeoutSeconds')::int) end,
    finished_at   = case when v_status = 'FINISHED' then now() end
  where id = p_match;

  insert into public.game_actions (match_id, action_id, user_id, seat, action_type, cards, combination, version_after)
  values (p_match, p_action_id, v_actor, v_seat, p_action_type,
          case when v_is_play then p_cards end, v_combo, v_match.version + 1);

  if v_status = 'FINISHED' then
    -- Verify the engine's scores against the stored state, then persist them once [R17–R20].
    if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) <> 4 then
      raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
    end if;
    for v_player in
      select mp.seat, mp.user_id, mp.has_played, ps.hand
      from public.match_players mp
      join public.player_private_states ps on ps.match_id = mp.match_id and ps.user_id = mp.user_id
      where mp.match_id = p_match
      order by mp.seat
    loop
      select r into v_res from jsonb_array_elements(p_results) r where (r ->> 'seat')::int = v_player.seat;
      if v_res is null
         or jsonb_typeof(v_res -> 'isWinner') is distinct from 'boolean'
         or jsonb_typeof(v_res -> 'remainingCards') is distinct from 'number'
         or jsonb_typeof(v_res -> 'scoreDelta') is distinct from 'number'
         or jsonb_typeof(v_res -> 'remainingHand') is distinct from 'array'
         or jsonb_typeof(v_res -> 'penalties') is distinct from 'object'
         or (v_res ->> 'isWinner')::boolean is distinct from (v_player.seat = v_winner)
         or (v_res ->> 'remainingCards')::int is distinct from cardinality(v_player.hand)
         or (select coalesce(array_agg(c order by c), '{}') from jsonb_array_elements_text(v_res -> 'remainingHand') c)
            is distinct from (select coalesce(array_agg(c order by c), '{}') from unnest(v_player.hand) c) then
        raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
      end if;
      if v_player.seat <> v_winner then
        v_expected := case when not v_player.has_played then (v_config #>> '{scoring,congPenalty}')::int
                           else (v_config #>> '{scoring,perCard}')::int * cardinality(v_player.hand) end;
        -- thoi2 / thoiTuQuy score 0 in xam-baseline v1, so the loser pays exactly the base amount.
        if (v_res ->> 'scoreDelta')::int is distinct from -v_expected
           or coalesce(v_res -> 'penalties' -> 'cong' = 'true'::jsonb, false) is distinct from (not v_player.has_played) then
          raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
        end if;
      elsif coalesce(v_res -> 'penalties' -> 'cong' = 'true'::jsonb, false) then
        raise exception 'INTERNAL_ERROR' using errcode = 'P0001';  -- the winner can't be cóng
      end if;
      v_sum := v_sum + (v_res ->> 'scoreDelta')::int;

      insert into public.match_results (match_id, user_id, seat, is_winner, remaining_cards, remaining_hand, score_delta, penalties)
      values (p_match, v_player.user_id, v_player.seat, v_player.seat = v_winner, cardinality(v_player.hand),
              array(select jsonb_array_elements_text(v_res -> 'remainingHand')),
              (v_res ->> 'scoreDelta')::int, coalesce(v_res -> 'penalties', '{}'));

      update public.profiles set
        total_score    = total_score + (v_res ->> 'scoreDelta')::int,
        matches_played = matches_played + 1,
        matches_won    = matches_won + case when v_player.seat = v_winner then 1 else 0 end
      where id = v_player.user_id;
    end loop;
    if v_sum is distinct from 0 then
      raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
    end if;

    update public.match_players
    set status = case when seat = v_winner then 'WON' else 'LOST' end
    where match_id = p_match;
    update public.game_rooms
    set status = 'WAITING', last_winner_seat = v_winner
    where id = v_match.room_id;
    perform public.notify_room(v_match.room_id, 'match_finished', jsonb_build_object('matchId', p_match));
  end if;

  -- Delivered only after commit. Public data only: never hands.
  perform realtime.send(public.match_public_state(p_match), 'state', 'match:' || p_match, true);
  return public.match_public_state(p_match);
end;
$$;

revoke all on function public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb) to service_role;
