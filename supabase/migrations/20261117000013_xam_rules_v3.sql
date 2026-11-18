-- 0013 · Báo Xâm (DECLARE_SAM, SAM_CAUGHT, SAM_SUCCESS), Thối 2 cuối (THOI_2_CUOI),
-- and allowing any seated player to continue the next match after a match ends.

alter table public.matches
  add column if not exists sam_seat smallint check (sam_seat between 0 and 3),
  add column if not exists foul_seat smallint check (foul_seat between 0 and 3),
  add column if not exists end_reason text check (end_reason in ('NORMAL', 'THOI_2_CUOI', 'SAM_SUCCESS', 'SAM_CAUGHT'));

alter table public.game_actions drop constraint if exists game_actions_action_type_check;
alter table public.game_actions
  add constraint game_actions_action_type_check check (
    action_type in ('DEAL', 'PLAY', 'PASS', 'DECLARE_SAM', 'TIMEOUT_PASS', 'TIMEOUT_PLAY', 'ABORT', 'FINISH')
  );

create or replace function public.start_match(p_user uuid, p_room uuid, p_hands jsonb, p_first_seat smallint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room      public.game_rooms%rowtype;
  v_config    jsonb;
  v_min       int;
  v_max       int;
  v_n         int;
  v_ranked    boolean;
  v_winner_ix int;
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
  -- First match in the room requires the host; subsequent matches ("Tiếp tục") may be started by any seated player.
  if v_room.current_match_id is null then
    if v_room.host_id <> p_user then
      raise exception 'NOT_ROOM_HOST' using errcode = 'P0001';
    end if;
  else
    if v_room.host_id <> p_user and not exists (
      select 1 from public.room_players
      where room_id = p_room and user_id = p_user and status = 'ACTIVE' and role = 'PLAYER'
    ) then
      raise exception 'NOT_ROOM_HOST' using errcode = 'P0001';
    end if;
  end if;
  if v_room.status <> 'WAITING' then
    raise exception 'MATCH_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select config into v_config from public.game_rulesets where id = v_room.ruleset_id;
  v_min := coalesce((v_config ->> 'minPlayers')::int, (v_config ->> 'players')::int);
  v_max := coalesce((v_config ->> 'maxPlayers')::int, (v_config ->> 'players')::int);

  create temp table if not exists pg_temp.start_players (ix int, user_id uuid, is_bot boolean, is_locked boolean, balance int) on commit drop;
  truncate pg_temp.start_players;
  insert into pg_temp.start_players
  select (row_number() over (order by rp.seat) - 1)::int, rp.user_id, p.is_bot, p.is_locked, p.total_score
  from public.room_players rp
  join public.profiles p on p.id = rp.user_id
  where rp.room_id = p_room and rp.status = 'ACTIVE' and rp.role = 'PLAYER';
  select count(*) into v_n from pg_temp.start_players;

  if v_n < v_min or v_n > v_max then
    raise exception 'NOT_ENOUGH_PLAYERS' using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_temp.start_players where is_locked and not is_bot) then
    raise exception 'ACCOUNT_LOCKED' using errcode = 'P0001';
  end if;
  v_ranked := not exists (select 1 from pg_temp.start_players where is_bot);
  if v_ranked and (v_config #>> '{scoring,minBalanceToPlay}') is not null
     and exists (select 1 from pg_temp.start_players where balance < (v_config #>> '{scoring,minBalanceToPlay}')::int) then
    raise exception 'NOT_ENOUGH_POINTS' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_hands) is distinct from 'array' or jsonb_array_length(p_hands) <> v_n then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  for i in 0..v_n - 1 loop
    if jsonb_typeof(p_hands -> i) is distinct from 'array' then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    v_hand := array(select jsonb_array_elements_text(p_hands -> i));
    if cardinality(v_hand) <> (v_config ->> 'handSize')::int or not public.is_valid_card_array(v_hand) then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
    v_all := v_all || v_hand;
  end loop;
  if not public.is_valid_card_array(v_all) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select ix into v_winner_ix from pg_temp.start_players where user_id = v_room.last_winner_user_id;
  if p_first_seat is null or p_first_seat < 0 or p_first_seat >= v_n
     or (v_winner_ix is not null and p_first_seat <> v_winner_ix) then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select coalesce(max(match_no), 0) + 1 into v_match_no from public.matches where room_id = p_room;
  insert into public.matches (room_id, ruleset_id, match_no, version, current_seat, lead_seat, ranked, turn_deadline)
  values (p_room, v_room.ruleset_id, v_match_no, 1, p_first_seat, p_first_seat, v_ranked,
          now() + make_interval(secs => (v_config ->> 'turnTimeoutSeconds')::int))
  returning id into v_match;

  for v_player in select ix, user_id from pg_temp.start_players order by ix loop
    v_hand := array(select jsonb_array_elements_text(p_hands -> v_player.ix));
    insert into public.match_players (match_id, user_id, seat, card_count)
    values (v_match, v_player.user_id, v_player.ix, cardinality(v_hand));
    insert into public.player_private_states (match_id, user_id, hand) values (v_match, v_player.user_id, v_hand);
  end loop;

  insert into public.game_actions (match_id, action_id, user_id, action_type, version_after)
  values (v_match, gen_random_uuid(), p_user, 'DEAL', 1);
  update public.game_rooms set status = 'PLAYING', current_match_id = v_match where id = p_room;

  perform public.notify_room(p_room, 'match_started', jsonb_build_object('matchId', v_match));
  return public.match_public_state(v_match) || jsonb_build_object('ranked', v_ranked);
end;
$$;

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
  v_match       public.matches%rowtype;
  v_config      jsonb;
  v_n           int;
  v_timeout     boolean := p_action_type in ('TIMEOUT_PASS', 'TIMEOUT_PLAY');
  v_is_play     boolean := p_action_type in ('PLAY', 'TIMEOUT_PLAY');
  v_is_sam      boolean := p_action_type = 'DECLARE_SAM';
  v_actor       uuid;
  v_seat        smallint;
  v_hand        text[];
  v_new_hand    text[];
  v_status      text := p_next ->> 'status';
  v_winner      smallint := (p_next ->> 'winnerSeat')::smallint;
  v_next        smallint := (p_next ->> 'currentSeat')::smallint;
  v_lead        smallint := (p_next ->> 'leadSeat')::smallint;
  v_sam_seat    smallint := (p_next ->> 'samSeat')::smallint;
  v_foul_seat   smallint := (p_next ->> 'foulSeat')::smallint;
  v_end_reason  text := p_next ->> 'endReason';
  v_combo       text := p_next ->> 'combination';
  v_res         jsonb;
  v_player      record;
  v_expected    int;
  v_sum         int := 0;
  v_cap         boolean;
  v_paid        jsonb := '{}';
  v_pay         int;
  v_paid_sum    int := 0;
  v_winner_user uuid;
begin
  if p_action_type not in ('PLAY', 'PASS', 'DECLARE_SAM', 'TIMEOUT_PASS', 'TIMEOUT_PLAY') then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;

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
  select count(*) into v_n from public.match_players where match_id = p_match;

  if v_timeout then
    if v_match.turn_deadline is null or v_match.turn_deadline > now() then
      raise exception 'TURN_NOT_EXPIRED' using errcode = 'P0001';
    end if;
    select user_id, seat into v_actor, v_seat
    from public.match_players where match_id = p_match and seat = v_match.current_seat;
  elsif v_is_sam then
    v_actor := p_user;
    select seat into v_seat from public.match_players where match_id = p_match and user_id = p_user;
    if v_match.sam_seat is not null or exists (select 1 from public.match_players where match_id = p_match and has_played) then
      raise exception 'INVALID_REQUEST' using errcode = 'P0001';
    end if;
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

  if v_status is null or v_status not in ('PLAYING', 'FINISHED')
     or (v_status = 'FINISHED' and v_winner is null)
     or (v_status = 'PLAYING' and v_winner is not null)
     or (v_status = 'PLAYING' and (v_next is null or v_next < 0 or v_next >= v_n))
     or v_lead is null or v_lead < 0 or v_lead >= v_n
     or (v_status = 'FINISHED' and v_match.ranked) is distinct from (p_results is not null) then
    raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
  end if;

  -- When there is no foul (normal finish or SAM_SUCCESS), the player who emptied their hand must be the winner.
  if v_foul_seat is null then
    if (cardinality(v_new_hand) = 0) is distinct from (v_status = 'FINISHED' and v_winner is not distinct from v_seat) then
      raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
    end if;
  else
    if v_status <> 'FINISHED' or v_winner = v_foul_seat then
      raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
    end if;
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
    sam_seat      = coalesce(v_sam_seat, sam_seat),
    foul_seat     = v_foul_seat,
    end_reason    = v_end_reason,
    turn_deadline = case when v_status = 'PLAYING'
                         then now() + make_interval(secs => (v_config ->> 'turnTimeoutSeconds')::int) end,
    finished_at   = case when v_status = 'FINISHED' then now() end
  where id = p_match;

  insert into public.game_actions (match_id, action_id, user_id, seat, action_type, cards, combination, version_after)
  values (p_match, p_action_id, v_actor, v_seat, p_action_type,
          case when v_is_play then p_cards end, v_combo, v_match.version + 1);

  if v_status = 'FINISHED' then
    select user_id into v_winner_user from public.match_players where match_id = p_match and seat = v_winner;

    if v_match.ranked then
      if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) <> v_n then
        raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
      end if;
      v_cap := coalesce((v_config #>> '{scoring,capLossAtBalance}')::boolean, false);
      for v_player in
        select mp.seat, mp.user_id, mp.has_played, ps.hand, pr.total_score as balance
        from public.match_players mp
        join public.player_private_states ps on ps.match_id = mp.match_id and ps.user_id = mp.user_id
        join public.profiles pr on pr.id = mp.user_id
        where mp.match_id = p_match
        order by mp.seat
        for update of pr
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

        if v_foul_seat is not null then
          -- Foul finish (THOI_2_CUOI or SAM_CAUGHT): only foulSeat pays
          if v_player.seat = v_foul_seat then
            v_expected := case when v_end_reason = 'SAM_CAUGHT' then 20 * (v_n - 1)
                               else (v_config #>> '{scoring,congPenalty}')::int end;
            if (v_res ->> 'scoreDelta')::int is distinct from -v_expected then
              raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
            end if;
            v_pay := case when v_cap then least(v_expected, v_player.balance) else v_expected end;
            v_paid := v_paid || jsonb_build_object(v_player.seat::text, v_pay);
            v_paid_sum := v_paid_sum + v_pay;
          elsif v_player.seat <> v_winner then
            if (v_res ->> 'scoreDelta')::int is distinct from 0 then
              raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
            end if;
            v_paid := v_paid || jsonb_build_object(v_player.seat::text, 0);
          end if;
        else
          -- Normal finish or SAM_SUCCESS
          if v_player.seat <> v_winner then
            if v_end_reason = 'SAM_SUCCESS' then
              v_expected := 20;
            else
              v_expected := case when not v_player.has_played then (v_config #>> '{scoring,congPenalty}')::int
                                 else (v_config #>> '{scoring,perCard}')::int * cardinality(v_player.hand) end;
              if coalesce(v_res -> 'penalties' -> 'cong' = 'true'::jsonb, false) is distinct from (not v_player.has_played) then
                raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
              end if;
            end if;
            if (v_res ->> 'scoreDelta')::int is distinct from -v_expected then
              raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
            end if;
            v_pay := case when v_cap then least(v_expected, v_player.balance) else v_expected end;
            v_paid := v_paid || jsonb_build_object(v_player.seat::text, v_pay);
            v_paid_sum := v_paid_sum + v_pay;
          elsif coalesce(v_res -> 'penalties' -> 'cong' = 'true'::jsonb, false) then
            raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
          end if;
        end if;
        v_sum := v_sum + (v_res ->> 'scoreDelta')::int;
      end loop;
      if v_sum is distinct from 0 then
        raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
      end if;

      for v_player in
        select mp.seat, mp.user_id, ps.hand
        from public.match_players mp
        join public.player_private_states ps on ps.match_id = mp.match_id and ps.user_id = mp.user_id
        where mp.match_id = p_match
        order by mp.seat
      loop
        select r into v_res from jsonb_array_elements(p_results) r where (r ->> 'seat')::int = v_player.seat;
        v_pay := case when v_player.seat = v_winner then -v_paid_sum else coalesce((v_paid ->> v_player.seat::text)::int, 0) end;
        insert into public.match_results (match_id, user_id, seat, is_winner, remaining_cards, remaining_hand, score_delta, penalties)
        values (p_match, v_player.user_id, v_player.seat, v_player.seat = v_winner, cardinality(v_player.hand),
                array(select jsonb_array_elements_text(v_res -> 'remainingHand')),
                -v_pay,
                (v_res -> 'penalties') || case when v_player.seat <> v_winner and v_pay < -(v_res ->> 'scoreDelta')::int
                                               then jsonb_build_object('owed', -(v_res ->> 'scoreDelta')::int) else '{}'::jsonb end);
        update public.profiles set
          total_score    = total_score - v_pay,
          matches_played = matches_played + 1,
          matches_won    = matches_won + case when v_player.seat = v_winner then 1 else 0 end
        where id = v_player.user_id;
      end loop;
    end if;

    update public.match_players
    set status = case when seat = v_winner then 'WON' else 'LOST' end
    where match_id = p_match;
    update public.game_rooms
    set status = 'WAITING', last_winner_seat = v_winner, last_winner_user_id = v_winner_user
    where id = v_match.room_id;
    perform public.promote_waiting(v_match.room_id);
    perform public.notify_room(v_match.room_id, 'match_finished', jsonb_build_object('matchId', p_match));
  end if;

  perform realtime.send(public.match_public_state(p_match), 'state', 'match:' || p_match, true);
  return public.match_public_state(p_match);
end;
$$;

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
    'ranked', m.ranked,
    'currentSeat', m.current_seat,
    'leadSeat', m.lead_seat,
    'currentTrick', m.current_trick,
    'passedSeats', to_jsonb(m.passed_seats),
    'winnerSeat', m.winner_seat,
    'samSeat', m.sam_seat,
    'foulSeat', m.foul_seat,
    'endReason', m.end_reason,
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.start_match(uuid, uuid, jsonb, smallint)',
    'public.apply_game_action(uuid, uuid, uuid, bigint, text, text[], jsonb, jsonb)',
    'public.match_public_state(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
