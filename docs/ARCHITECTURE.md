# ARCHITECTURE — Xam Online

Status: DRAFT (awaiting review) · Last updated: 2026-11-16

## 1. Overview

```
 Browser (React + Vite, Vercel)                       Supabase Cloud
┌──────────────────────────────┐   HTTPS + JWT    ┌───────────────────────────────┐
│ Presentation  pages/components│ ───────────────▶ │ Edge Functions (Deno)          │
│ Application   features/hooks  │                  │  create-room  join-room        │
│ Domain (read-only helpers)    │                  │  start-match  play-cards       │
│ Infrastructure supabase-js    │                  │  pass-turn    finish-match     │
└──────────────┬───────────────┘                  │  claim-timeout (if R27 OK'd)   │
               │ SELECT (RLS)                     │      │ uses game-engine (pure TS)│
               │ Realtime (private channels)      │      ▼ service role            │
               └────────────────────────────────▶ │ PostgreSQL                     │
                                                  │  RLS on every table            │
                                                  │  apply_game_action() RPC       │
                                                  │  realtime.send() on commit     │
                                                  └───────────────────────────────┘
```

**Server-authoritative rule:** the client can only *read* through RLS and *request*
actions through Edge Functions. It cannot write any game table. Authenticated users have
no INSERT/UPDATE/DELETE grants on game tables (see DATABASE.md §4).

## 2. Repository layout

```
/
├─ src/                              # React app (Vite)
│  ├─ app/                           # router, providers, layouts
│  ├─ pages/                         # Login, Register, Lobby, CreateRoom, JoinRoom,
│  │                                 # WaitingRoom, GameTable, MatchResult, Profile, History
│  ├─ components/                    # UI only (cards, seats, buttons, shadcn/ui in components/ui)
│  ├─ features/                      # application layer, one folder per feature
│  │  ├─ auth/  rooms/  match/  history/
│  │  │   ├─ api.ts                  # calls Edge Functions / selects
│  │  │   ├─ hooks.ts                # useRoom, useMatch, useMyHand, ...
│  │  │   └─ store.ts                # Zustand: selection & UI state only
│  ├─ lib/
│  │  ├─ supabase.ts                 # anon client (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY only)
│  │  └─ realtime.ts                 # channel helpers, reconnect → refetch
│  └─ types/
├─ supabase/
│  ├─ migrations/                    # versioned SQL (schema, RLS, grants, RPCs)
│  ├─ tests/                         # pgTAP database/RLS tests
│  ├─ seed.sql                       # local-only test users & ruleset
│  └─ functions/
│     ├─ _shared/
│     │  ├─ game-engine/             # ★ DOMAIN LAYER: pure TS, zero dependencies
│     │  ├─ http.ts                  # JSON response + error envelope
│     │  ├─ auth.ts                  # JWT → user id
│     │  ├─ schemas.ts               # Zod request schemas
│     │  └─ db.ts                    # service-role client (server only)
│     ├─ create-room/ join-room/ start-match/
│     ├─ play-cards/ pass-turn/ finish-match/
├─ e2e/                              # Playwright
└─ docs/
```

### Where the game engine lives

The engine lives in `supabase/functions/_shared/game-engine/` and the frontend imports it through
the Vite/TS alias `@engine`. That puts it inside the functions tree, so it always ships with
`supabase functions deploy`, and the browser can still use it for **non-authoritative**
hints (e.g. greying out the PLAY button when the selection isn't a valid combination).
Constraints on the engine code:

- No imports from React, Supabase, Deno or Node. No `Date.now()` or `Math.random()` inside rule logic:
  the RNG is passed in, which keeps everything deterministic and testable.
- Relative imports use explicit `.ts` extensions (Deno requirement; Vite has `allowImportingTsExtensions`).
- Tested with Vitest from the repo root.

## 3. Domain layer: game engine modules

| Module | Responsibility |
|--------|----------------|
| `cards.ts` | `Card` type, encoding `"3S"…"TH"…"2D"` (T = 10), rank values 3..15 (A=14, 2=15) |
| `DeckFactory` | Build the 52 unique cards |
| `DeckShuffler` | Fisher–Yates with an injected RNG (`crypto.getRandomValues` on the server) |
| `CardDealer` | Deal `ruleset.handSize` cards to 4 seats |
| `CombinationValidator` | `classify(cards, ruleset) → Combination \| null` (type, size, key rank) |
| `CombinationComparator` | `canBeat(next, current, ruleset) → boolean`. **The only place comparison logic lives.** |
| `MoveValidator` | Turn, ownership, combination, beat check, leader-cannot-pass → `Result<ok, ErrorCode>` |
| `TurnManager` | Next seat (direction from ruleset), pass lock, round reset |
| `GameStateManager` | `applyAction(state, action, ruleset) → { nextState, events }`: a pure reducer |
| `WinnerEvaluator` | Detect the end of a match (R15) |
| `ScoreCalculator` | Score deltas per player from the final state (R17–R20) |
| `ruleset.ts` | `GameRuleSet` type + `XAM_BASELINE_V1` constant, matching the `game_rulesets.config` row |

`GameRuleSet` example (values depend on RULE_DECISIONS approval):

```ts
interface GameRuleSet {
  code: 'xam-baseline'; version: 1;
  handSize: 10; direction: 'CCW';
  suitsMatter: false;
  straight: { min: 3; max: 10; aceLow: true; twoAllowed: 'LOW_ONLY'; wrap: false };
  fourOfAKindBeats: 'SINGLE_TWO';
  passLocksRound: true;
  endCondition: 'FIRST_OUT';
  scoring: { perCard: 1; congPenalty: 15 };
  flags: { baoSam: false; baoMotDen: false; instantWin: false };
}
```

The engine refuses to run a ruleset whose `code`/`version` it doesn't know, so DB config
and code can't drift silently.

## 4. Action flow (play-cards / pass-turn)

1. **Authenticate**: verify the JWT with `supabase.auth.getUser(jwt)` → `userId`.
2. **Validate the body** with Zod: `{ actionId: uuid, matchId: uuid, expectedVersion: int, actionType, cards? }`.
3. **Load state** with the service-role client: the `matches` row, `match_players`, and the caller's `player_private_states` row.
4. **Check membership**: the caller has a seat in `match_players`, else `NOT_ROOM_MEMBER`.
5. **Early checks**: `actionId` already in `game_actions` → return `ACTION_ALREADY_PROCESSED`
   (with the stored result, so retries are safe); `version ≠ expectedVersion` → `VERSION_CONFLICT`.
6. **Engine**: `MoveValidator` + `GameStateManager.applyAction` → next state or an error code.
7. **Commit** through `rpc('apply_game_action', …)`, one PostgreSQL transaction that:
   - locks the match row (`SELECT … FOR UPDATE`) and re-checks `version = expectedVersion`;
   - inserts into `game_actions` (UNIQUE `(match_id, action_id)` is the final idempotency guard);
   - updates the caller's hand, `match_players.card_count`, the public match state, and `version = version + 1`;
   - if the match ended: sets status `FINISHED`, writes `match_results`, sets the room back to `WAITING`;
   - calls `realtime.send()` with the **public** state to the private topic `match:<id>`
     (delivered only after commit).
8. **Respond** `{ ok: true, version, publicState }`, or `{ ok: false, error: { code, message } }`.

Steps 5 and 7 both check the version on purpose. The Edge Function check only exists to fail fast; the
row-locked check inside the RPC is what actually guarantees correctness (master prompt §8).

## 5. Realtime design

| Channel | Type | Content | Authorization |
|---------|------|---------|---------------|
| `room:<roomId>` | private, Presence + Broadcast | who is online, seat changes, "match started" | RLS on `realtime.messages`: caller is an active `room_players` member |
| `match:<matchId>` | private, Broadcast | public state + version after every commit | RLS: caller has a seat in `match_players` |

- **Private hands are never broadcast.** When a client receives a new version, it re-fetches its own
  hand with `select … from player_private_states` (RLS: `user_id = auth.uid()`).
- **Reconnect:** on `SUBSCRIBED` after a drop, and when the tab becomes visible, the client re-fetches the full
  public state and its own hand. If an incoming broadcast's version is more than one ahead of the local one, it re-fetches too.
- Presence drives the connection-status badge only. It never affects game logic.

## 6. Frontend state

- **Server state** (room, match, my hand): fetched through feature hooks, replaced wholesale on each version.
  No optimistic updates to authoritative data.
- **Zustand**: selected cards, pending-request flag, sort order, toasts. Nothing that decides validity.
- **Error handling**: on `VERSION_CONFLICT`, refetch silently and keep the selection. Other errors show a toast in Vietnamese.

## 7. Security model

| Risk | Mitigation |
|------|-----------|
| A client writes game state | No write grants for `authenticated`/`anon` on game tables; writes only through SECURITY DEFINER RPCs executable by `service_role` alone |
| Hand leakage | `player_private_states` RLS restricts to your own row; hands never in broadcasts or `game_actions` public columns until played |
| Leaked service key | Only in Edge Function secrets; Vite exposes only `VITE_*` (URL + anon key); CI greps the bundle for `service_role` |
| Replay or double-submit | `actionId` UUID + UNIQUE constraint; idempotent response |
| Race between two clients | Row lock + version check in the RPC |
| Predictable shuffle | `crypto.getRandomValues`; the seed is never stored in a client-readable column |
| Room enumeration | No public listing; joining by code goes through an Edge Function with rate limiting (per-user attempt counter) |
| Error leakage | One error envelope; stack traces only in function logs |

## 8. Error envelope

```json
{ "ok": false, "error": { "code": "NOT_YOUR_TURN", "message": "Chưa đến lượt bạn" } }
```

Codes: master prompt §13, plus the additions in RULE_DECISIONS C6. HTTP status: 400 validation,
401 unauthorized, 403 permission, 404 not found, 409 version/duplicate/state, 500 internal.

## 9. Environments and deployment

- Local: `supabase start` (Supabase CLI) for Postgres, Auth, Realtime and Functions; `npm run dev` for Vite.
  (Supabase CLI uses containers internally. That is a dev tool, not part of our architecture.)
- Production: Vercel (frontend, SPA rewrites), Supabase Cloud (migrations through `supabase db push`, functions through `supabase functions deploy`).
- Secrets: `SUPABASE_SERVICE_ROLE_KEY` exists only in Supabase function secrets. Vercel env holds only the URL and anon key.
