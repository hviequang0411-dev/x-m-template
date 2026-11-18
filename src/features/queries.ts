/**
 * PostgREST select strings used by the frontend. Kept here (no imports) so the integration suite
 * can run each one, exactly as written, against the real database as a real player.
 *
 * matches ↔ game_rooms has TWO foreign keys (matches.room_id and game_rooms.current_match_id), so
 * every embed between them must name the FK, or PostgREST answers 300 Multiple Choices.
 */

export const ACTIVE_ROOM_SELECT = 'seat, role, room:game_rooms!inner(id, code, status)'

export const ROOM_SELECT =
  'id, code, status, host_id, current_match_id, ' +
  'players:room_players(seat, role, user_id, status, joined_at, profile:profiles(display_name, is_bot, total_score, avatar_id))'

export const MATCH_SELECT =
  'id, room_id, turn_deadline, ranked, room:game_rooms!matches_room_id_fkey(host_id), version, status, current_seat, lead_seat, ' +
  'current_trick, passed_seats, winner_seat, ' +
  'players:match_players(seat, user_id, card_count, has_played, status, profile:profiles(display_name, is_bot, avatar_id, total_score))'

export const HAND_SELECT = 'hand'

export const RESULTS_SELECT =
  'seat, user_id, is_winner, remaining_cards, remaining_hand, score_delta, penalties, profile:profiles(display_name)'

export const HISTORY_SELECT =
  'match_id, is_winner, remaining_cards, score_delta, penalties, created_at, ' +
  'match:matches(finished_at, room:game_rooms!matches_room_id_fkey(code))'

export const PROFILE_SELECT = 'id, username, display_name, total_score, matches_played, matches_won, is_admin, is_locked, avatar_id'

export const CHAT_SELECT = 'id, room_id, user_id, kind, body, created_at, profile:profiles(display_name)'
