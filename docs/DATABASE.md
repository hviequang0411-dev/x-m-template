# DATABASE — Xam Online

Status: DRAFT (awaiting review) · PostgreSQL (Supabase) · Last updated: 2026-11-16

All primary keys are `uuid default gen_random_uuid()` unless noted. All tables have `created_at timestamptz not null default now()`;
mutable tables also have `updated_at` maintained by a trigger. Status fields are `text` with `CHECK` constraints
(simpler to migrate than Postgres enums).

## 1. Entity overview

```
auth.users 1─1 profiles
profiles 1─* game_rooms (host)        game_rulesets 1─* game_rooms / matches
game_rooms 1─* room_players *─1 profiles
game_rooms 1─* matches 1─* match_players *─1 profiles
matches 1─* player_private_states (one per seat, server-only writes)
matches 1─* game_actions
matches 1─* match_results (one per player)
```

## 2. Tables

### profiles
| column | type | notes |
|---|---|---|
| id | uuid PK | FK → `auth.users(id)` on delete cascade |
| username | text | UNIQUE, `^[a-z0-9_]{3,20}$` |
| display_name | text | 1–32 chars |
| avatar_url | text null | |
| total_score | integer | default 0, updated only by the RPC |
| matches_played / matches_won | integer | default 0, updated only by the RPC |

Created by an `after insert on auth.users` trigger (SECURITY DEFINER).

### game_rulesets
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| code | text | e.g. `xam-baseline` |
| version | integer | UNIQUE `(code, version)` |
| status | text | `DRAFT` / `APPROVED` / `RETIRED` |
| config | jsonb | serialised `GameRuleSet` (ARCHITECTURE §3) |

Only `APPROVED` rulesets can be used to start a match. Rows are immutable once `APPROVED`; changing a rule means a new version.

### game_rooms
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| code | text | UNIQUE, 6 chars from `A-Z2-9` without ambiguous ones (no 0/O/1/I) |
| host_id | uuid | FK → profiles |
| ruleset_id | uuid | FK → game_rulesets |
| status | text | `WAITING` / `PLAYING` / `CLOSED` |
| max_players | smallint | `CHECK (max_players = 4)` |
| current_match_id | uuid null | FK → matches (deferrable) |
| last_winner_seat | smallint null | for R14 |

Index: `(status)`; partial unique index on `code` where `status <> 'CLOSED'` if we want to reuse codes (decide at implementation; the default is a global UNIQUE).

### room_players
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| room_id | uuid | FK → game_rooms on delete cascade |
| user_id | uuid | FK → profiles |
| seat | smallint | `CHECK (seat between 0 and 3)` |
| status | text | `ACTIVE` / `LEFT` |
| joined_at / left_at | timestamptz | |

- Partial UNIQUE `(room_id, user_id) WHERE status='ACTIVE'`: no duplicate joins.
- Partial UNIQUE `(room_id, seat) WHERE status='ACTIVE'`: no seat collisions.
- Partial UNIQUE `(user_id) WHERE status='ACTIVE'`: one active room per user (MVP simplification).
- Capacity: enforced in the `join_room` RPC under `SELECT … FOR UPDATE` on the room row.

### matches (public, authoritative state)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| room_id | uuid | FK |
| ruleset_id | uuid | FK (frozen at start) |
| match_no | integer | UNIQUE `(room_id, match_no)` |
| status | text | `PLAYING` / `FINISHED` / `ABORTED` |
| version | bigint | starts at 0, +1 per committed action |
| current_seat | smallint | whose turn it is |
| lead_seat | smallint null | who played the current trick (null = fresh round) |
| current_trick | jsonb null | `{ "type":"PAIR", "cards":["7S","7H"], "seat":2 }` |
| passed_seats | smallint[] | seats locked out this round (R10) |
| turn_deadline | timestamptz null | R27 |
| winner_seat | smallint null | |
| started_at / finished_at | timestamptz | |

Index: `(room_id, status)`. Partial UNIQUE `(room_id) WHERE status='PLAYING'`: one live match per room.

### match_players (public per-seat info)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| match_id | uuid | FK on delete cascade |
| user_id | uuid | FK |
| seat | smallint | UNIQUE `(match_id, seat)`; UNIQUE `(match_id, user_id)` |
| card_count | smallint | `CHECK (card_count >= 0)` |
| has_played | boolean | for cóng (R18) |
| status | text | `PLAYING` / `WON` / `LOST` / `FORFEITED` |

### player_private_states (secret)
| column | type | notes |
|---|---|---|
| match_id | uuid | PK part, FK |
| user_id | uuid | PK part, FK |
| hand | text[] | card codes, e.g. `{3S,7H,TD}` |
| updated_at | timestamptz | |

`CHECK (cardinality(hand) <= 13)`. Never broadcast; never joined into public views.

### game_actions (append-only log)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| match_id | uuid | FK |
| action_id | uuid | client-generated; UNIQUE `(match_id, action_id)` |
| user_id | uuid null | null for SYSTEM actions |
| seat | smallint | |
| action_type | text | `DEAL` / `PLAY` / `PASS` / `TIMEOUT_PASS` / `TIMEOUT_PLAY` / `ABORT` / `FINISH` |
| cards | text[] null | only cards that have been **played** (public) |
| combination | text null | `SINGLE` … `FOUR_OF_A_KIND` |
| version_after | bigint | UNIQUE `(match_id, version_after)`: a second commit on the same version is impossible |

Index: `(match_id, version_after)`. A DEAL action never stores hands.

### match_results
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| match_id | uuid | FK; UNIQUE `(match_id, user_id)` |
| user_id | uuid | FK |
| seat | smallint | |
| is_winner | boolean | |
| remaining_cards | smallint | |
| remaining_hand | text[] | revealed at match end |
| score_delta | integer | |
| penalties | jsonb | e.g. `{ "cong": true }` |

Index: `(user_id, created_at desc)` for match history.

## 3. RPC functions (all `SECURITY DEFINER`, `set search_path = ''`)

| Function | Called by | Purpose |
|---|---|---|
| `create_room(p_user, p_ruleset_code)` | Edge `create-room` | Generate a unique code (retry on collision), insert the room + host at seat 0 |
| `join_room(p_user, p_code)` | Edge `join-room` | Lock the room, check status/capacity/duplicates, take the lowest free seat |
| `start_match(p_user, p_room, p_hands jsonb, p_first_seat)` | Edge `start-match` | Check host, 4 active players, room `WAITING`; insert match, match_players, private states, DEAL action; room → `PLAYING` |
| `apply_game_action(p_match, p_action_id, p_user, p_expected_version, p_action_type, p_cards, p_next jsonb)` | Edge `play-cards` / `pass-turn` / `claim-timeout` | ARCHITECTURE §4 step 7. Returns `{ ok, version }` or raises an error code |
| `finish_match(p_user, p_match, p_reason)` | Edge `finish-match` | Abort only (R30) |

The deck is shuffled and dealt **in the Edge Function** with the TypeScript engine (one implementation), then passed into the RPC.
`EXECUTE` on these functions: `REVOKE ALL FROM public, anon, authenticated; GRANT EXECUTE TO service_role`.

Inside `apply_game_action`, as a defence in depth, the RPC also checks that the cards removed from
the hand are actually in the stored hand (`p_cards <@ hand`) and that `card_count = cardinality(hand)` after the update,
so a bug in the Edge Function cannot invent cards.

Errors are raised as `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='VERSION_CONFLICT'`, and the Edge Function maps them to the envelope.

## 4. RLS and grants

Default for every table: `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL ON … FROM anon, authenticated`; then grant explicitly:

| Table | `authenticated` grant | RLS policy (SELECT) | Writes |
|---|---|---|---|
| profiles | SELECT; UPDATE(display_name, avatar_url) | all authenticated can read (needed to show opponent names); UPDATE only `id = auth.uid()` | trigger / RPC |
| game_rulesets | SELECT | `status = 'APPROVED'` | migrations only |
| game_rooms | SELECT | caller is an ACTIVE member (`is_room_member(id)`) | RPC only |
| room_players | SELECT | caller is an ACTIVE member of the same room | RPC only |
| matches | SELECT | caller has a seat in `match_players` | RPC only |
| match_players | SELECT | caller has a seat in the same match | RPC only |
| player_private_states | SELECT | `user_id = auth.uid()` **only** | RPC only |
| game_actions | SELECT (holds only public, already-played cards) | caller has a seat in the match | RPC only |
| match_results | SELECT | caller has a seat in the match | RPC only |

`anon` gets nothing. Membership helpers (`is_room_member`, `is_match_player`) are `SECURITY DEFINER STABLE`
functions so the policies don't recurse.

Realtime: RLS policies on `realtime.messages` allow `SELECT` (receive) on topic `match:<id>` / `room:<id>`
only for members, and allow `INSERT` (client send) only for Presence on `room:<id>`.

## 5. Database tests (pgTAP, `supabase test db`)

- User A cannot select User B's `player_private_states` row.
- An authenticated user cannot INSERT/UPDATE/DELETE any game table (each one tried).
- An authenticated user cannot `EXECUTE apply_game_action`.
- A non-member cannot see rooms/matches/actions.
- `apply_game_action` with a stale version → `VERSION_CONFLICT`; the same `action_id` twice → `ACTION_ALREADY_PROCESSED`.
- `join_room` on a full room → `ROOM_FULL`; joining twice → `ALREADY_IN_ROOM`.
- `start_match` by a non-host → `NOT_ROOM_HOST`; with 3 players → `NOT_ENOUGH_PLAYERS`.

## 6. Migration plan

| File | Contents | Status |
|---|---|---|
| `20261116000001_profiles_and_rulesets.sql` | `set_updated_at`, profiles + `handle_new_user` trigger, game_rulesets + immutability trigger, `xam-baseline` v1 seed (approved) | ✅ applied |
| `20261116000002_rooms.sql` | game_rooms, room_players, `is_room_member`, RLS/grants | ✅ applied |
| `20261116000003_matches.sql` | `is_valid_card_array`, matches, match_players, player_private_states, game_actions, match_results, `is_match_player`, RLS/grants | ✅ applied |
| `20261116000004_room_rpcs.sql` | `notify_room`, `generate_room_code`, `create_room`, `join_room`, `leave_room` (WAITING rooms only; host handoff, close when empty) | ✅ applied |
| `20261116000005_game_rpcs.sql` | `match_public_state`, `start_match`, `apply_game_action` | ✅ applied |
| `20261116000006_realtime_policies.sql` | `can_access_topic`, `realtime.messages` policies (receive on `room:`/`match:` for members, Presence insert on `room:`) | ✅ applied |
| `20261116000007_results_timeout_abort.sql` | `apply_game_action` v2 (TIMEOUT_PASS/TIMEOUT_PLAY claims, `p_results` verified and written to `match_results` + `profiles` once), `finish_match` (abort) | ✅ applied |
| `20261116000008_null_safe_result_checks.sql` | `apply_game_action`: NULL-safe result checks (see below) | ✅ applied |
| `20261117000009_rules_v2_schema.sql` | ruleset v2 row; `profiles.is_admin / is_locked / is_bot`, balance default 10 and ≥ 0; `room_players.role` (PLAYER/WAITING, nullable seat); `game_rooms.last_winner_user_id`; `matches.ranked`; `point_adjustments`; `can_view_match` (watchers) | ✅ applied |
| `20261117000010_room_rpcs_v2.sql` | `create_room`/`join_room`/`leave_room` v2, `promote_waiting`, `free_seat`, `add_bot`, `remove_bot`, `idle_bot`, `assert_not_locked` | ✅ applied |
| `20261117000011_game_rpcs_v2.sql` | `start_match` (2–4, ranked, 10-point minimum), `apply_game_action` (balance cap, unranked bot matches, promotion), `finish_match`, `match_public_state` (+ranked) | ✅ applied |
| `20261117000012_admin.sql` | `admin_list_users`, `admin_adjust_points`, `admin_set_locked` | ✅ applied |

**Making an admin:** `update public.profiles set is_admin = true where username = '<username>';` (SQL editor or psql; there is no UI for it).

The room RPCs moved from 0002 to Day 5 so they're written alongside the Edge Functions that call them.

Notes on the Day 6 RPCs:
- **Scores** are computed by the engine's `calculateScores` and passed as `p_results`; the RPC re-derives what it can
  (winner, remaining hand = stored hand, loser pays 15 if `has_played = false` else 1 × cards, cóng flag, sum = 0) and refuses
  anything else with `INTERNAL_ERROR`. Results are written inside the same locked transaction that sets `FINISHED`, so they are
  persisted exactly once.
- **0008 fixes a bug found by `004_security_suite`:** in 0007, checks like `(penalties->>'cong') = 'true' <> …` evaluate to NULL
  when a key is missing, and `IF NULL` does not raise, so a payload without the cóng flag (or without `isWinner`, `remainingCards`,
  `scoreDelta`, or a FINISHED state without a winner) was accepted. All checks now use `IS DISTINCT FROM` and require each field
  with the right JSON type.
- **Timeout claims** (R27): any seated player may send `TIMEOUT_*` once `turn_deadline < now()` (database clock); the action is
  logged for the seat whose turn it was. Early claims → `TURN_NOT_EXPIRED`.
- **Abort** (R30): host only, at any time (the 5-minute stall condition was removed in 0014); status `ABORTED`,
  no results, room back to `WAITING`.

Notes on the Day 5 RPCs:
- `start_match` starts at `version = 1` (the DEAL action is `version_after = 1`); every action adds 1.
- `apply_game_action` checks, in this order under `SELECT … FOR UPDATE`: duplicate `action_id` → `ACTION_ALREADY_PROCESSED`,
  version → `VERSION_CONFLICT`, status, membership, turn, `p_cards <@ hand` → `CARD_NOT_OWNED`, and that "hand is now empty"
  agrees with the engine's `FINISHED`/winner (else `INTERNAL_ERROR`). The `state` broadcast goes out after commit and contains
  only `match_public_state` (card counts, never hands).
- Error codes, HTTP statuses and Vietnamese messages: `supabase/functions/_shared/errors.ts`.

Database tests live in `supabase/tests/database/` (`001_schema_constraints`, 22 assertions; `002_rls_security`, 38 assertions;
`003_rpcs`, 28 assertions; `004_security_suite`, 62 assertions: every table × INSERT/UPDATE/DELETE closed to clients, every RPC
service-role only, score columns not writable, results verification, timeout, abort). Run them with `npm run db:test`. End-to-end checks against the running stack (functions, RLS, Realtime,
concurrency) are in `tests/integration/`; run them with `npm run test:integration`.
