# API spec

All game writes go through these Edge Functions. Reads go through PostgREST with RLS (see [DATABASE.md](DATABASE.md)).

## Conventions
- `POST https://<project>.supabase.co/functions/v1/<name>` with headers `Authorization: Bearer <user JWT>`,
  `apikey: <anon key>`, `Content-Type: application/json`.
- Bodies are validated with Zod (`supabase/functions/_shared/schemas.ts`); unknown keys are rejected.
- Success: `{ "ok": true, ...result }` (HTTP 200).
- Error: `{ "ok": false, "error": { "code": "...", "message": "<Vietnamese>" } }` with the status below.
  Codes, statuses and messages live in one table: `supabase/functions/_shared/errors.ts`.
- **Idempotency:** game actions carry a client-generated `actionId` (UUID). Sending the same `actionId` again returns the
  current state with `"duplicate": true` and commits nothing. Clients retry a dropped request once with the same body.
- **Concurrency:** `expectedVersion` must equal the match's current `version`, or the call fails with `VERSION_CONFLICT`
  (refetch and try again). The check is repeated under a row lock in the database.

## Rooms
| Function | Body | Result | Errors |
|---|---|---|---|
| `create-room` | `{}` | `{ roomId, code, seat: 0 }` | `ALREADY_IN_ROOM` |
| `join-room` | `{ code }` (6 chars, case-insensitive, no 0/O/1/I) | `{ roomId, code, seat, role }`: the lowest free seat (`role: PLAYER`) while the room is waiting; otherwise `role: WAITING`, `seat: null` (R37) | `ROOM_NOT_FOUND`, `ROOM_FULL` (8 members), `ALREADY_IN_ROOM`, `ACCOUNT_LOCKED` |
| `add-bot` | `{ roomId }` | `{ roomId, botId, seat }` | `NOT_ROOM_HOST`, `ROOM_FULL` (no free seat), `MATCH_IN_PROGRESS` |
| `remove-bot` | `{ roomId, botId }` | `{ roomId, botId, removed: true }` | `NOT_ROOM_HOST`, `INVALID_REQUEST` (not a bot in this room), `MATCH_IN_PROGRESS` |
| `leave-room` | `{ roomId }` | `{ roomId, left: true }` | `NOT_ROOM_MEMBER`, `MATCH_IN_PROGRESS` (leaving mid-match is not supported yet) |

Host leaves → the lowest occupied seat becomes host; the last one out closes the room (R33).

## Matches
| Function | Body | Result | Errors |
|---|---|---|---|
| `start-match` | `{ roomId }` | `{ matchId, version: 1, ranked, state }` | `NOT_ROOM_MEMBER`, `NOT_ROOM_HOST`, `NOT_ENOUGH_PLAYERS` (fewer than 2 seated), `NOT_ENOUGH_POINTS` (ranked and someone has < 10), `ACCOUNT_LOCKED`, `MATCH_IN_PROGRESS` |
| `play-cards` | `{ actionId, matchId, expectedVersion, cards: ["3S", …] }` | `{ version, state, duplicate? }` | `VERSION_CONFLICT`, `NOT_YOUR_TURN`, `CARD_NOT_OWNED`, `INVALID_COMBINATION`, `CANNOT_BEAT_CURRENT_PLAY`, `MATCH_NOT_ACTIVE` |
| `pass-turn` | `{ actionId, matchId, expectedVersion }` | `{ version, state, duplicate? }` | `VERSION_CONFLICT`, `NOT_YOUR_TURN`, `LEADER_CANNOT_PASS`, `MATCH_NOT_ACTIVE` |
| `claim-timeout` | `{ actionId, matchId, expectedVersion }` | `{ version, state, duplicate? }` | `TURN_NOT_EXPIRED`, `VERSION_CONFLICT`, `MATCH_NOT_ACTIVE` |
| `finish-match` | `{ matchId }` | `{ version, state }` (status `ABORTED`) | `NOT_ROOM_HOST`, `MATCH_NOT_ACTIVE` |

- `start-match` shuffles with crypto RNG and deals 10 cards each. The first match is led by a random seat, later matches by the
  previous winner's seat.
- `claim-timeout`: any seated player, once `turnDeadline` (30 s per turn) has passed. The current seat auto-passes, or
  auto-plays its lowest single when leading (R27).
- `finish-match` aborts only (never declares a winner): host only, at any time (R30, migration 0014).
- When a play empties a hand the match ends in the same transaction: `match_results` and profile totals are written once.

- Ruleset v2: 2–4 seated players start; match seats are re-numbered 0…n−1. A match with a bot is `ranked: false`: no
  results, no points. After each human move (and after a start or a timeout claim) the server plays bots' turns in the
  background, one move about every 0.8 s.
- Ranked results: `score_delta` is what was actually paid; a loser who owed more than their balance has `penalties.owed` (R35).

## Admin (R38)
All three require `profiles.is_admin` (set by SQL); otherwise `NOT_ADMIN` (403).

| Function | Body | Result | Errors |
|---|---|---|---|
| `admin-users` | `{ query? }` | `{ users: [{ id, username, display_name, email, total_score, matches_played, matches_won, is_admin, is_locked, created_at }] }` (humans only, max 100) | `NOT_ADMIN` |
| `admin-adjust-points` | `{ userId, delta (≠ 0), reason (3–200 chars) }` | `{ userId, balance }`, logged in `point_adjustments` | `NOT_ADMIN`, `BALANCE_NEGATIVE`, `INVALID_REQUEST` |
| `admin-set-locked` | `{ userId, locked }` | `{ userId, locked }` | `NOT_ADMIN`, `INVALID_REQUEST` (yourself, or a bot) |

## Common errors
| Code | HTTP | When |
|---|---|---|
| `INVALID_REQUEST` | 400 | Body fails validation |
| `UNAUTHORIZED` | 401 | Missing or invalid user JWT |
| `METHOD_NOT_ALLOWED` | 405 | Not POST |
| `MATCH_NOT_FOUND` / `ROOM_NOT_FOUND` | 404 | Unknown id or code |
| `ACTION_ALREADY_PROCESSED` | 409 | Internal; surfaced to clients as an idempotent success |
| `INTERNAL_ERROR` | 500 | Anything unexpected (details only in function logs) |

## Public state (`state` field and Realtime broadcast)
```json
{
  "matchId": "uuid", "roomId": "uuid", "version": 7, "status": "PLAYING | FINISHED | ABORTED",
  "currentSeat": 2, "leadSeat": 0, "turnDeadline": "ISO time",
  "currentTrick": { "type": "STRAIGHT", "size": 3, "keyRank": 5, "cards": ["3S", "4H", "5D"] },
  "passedSeats": [3], "winnerSeat": null,
  "seats": [{ "seat": 0, "userId": "uuid", "cardCount": 8, "hasPlayed": true, "status": "PLAYING" }]
}
```
Never contains a hand. Card codes: rank `3-9 T J Q K A 2` + suit `S C D H`.

## Chat and emotes (migration 0015)
Not an Edge Function: the client calls the RPC directly with its own JWT.
- `supabase.rpc('send_room_message', { p_room, p_kind: 'TEXT' | 'EMOTE', p_body })` → the stored message (same shape as the `chat` event).
  Errors (`P0001` message): `INVALID_MESSAGE` (empty, > 200 chars, unknown emote/kind), `NOT_ROOM_MEMBER`, `ACCOUNT_LOCKED`,
  `RATE_LIMITED` (more than 5 messages per 10 s), `NOT_AUTHENTICATED`. Vietnamese texts: `src/features/chat/api.ts`.
- History: `from('room_messages').select(CHAT_SELECT)` (latest 50); RLS returns only messages sent since the caller joined.
- Avatar: `from('profiles').update({ avatar_id })` on the caller's own row.

## Realtime
Private channels, authorised by RLS on `realtime.messages`:
- `room:<roomId>`: active room members, seated or waiting. Events `players_changed`, `match_started { matchId }`, `match_finished { matchId }`,
  and `chat { id, roomId, userId, displayName, kind: 'TEXT' | 'EMOTE', body, createdAt }` (append to the chat, never a refetch).
  Presence (key = user id) shows who is online.
- `match:<matchId>`: seated players and the room's waiting members (watching). Event `state` = the public state above, sent after each commit.

Clients treat every event as "refetch"; their own hand is always re-read from `player_private_states` (own row only).
