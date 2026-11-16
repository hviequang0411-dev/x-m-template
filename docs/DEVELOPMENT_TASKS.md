# DEVELOPMENT TASKS — Xam Online

Status: DRAFT · Last updated: 2026-11-16
Complexity: S (< 2 h) · M (half a day) · L (a full day). ✅ = done, ⏳ = in progress, ⛔ = blocked.

## Phase 0: Analysis (today)

| ID | Task | Status |
|----|------|--------|
| T0.1 | Inspect the repo (result: empty, no docs) | ✅ |
| T0.2 | RULE_DECISIONS.md, ARCHITECTURE.md, DATABASE.md, DEVELOPMENT_TASKS.md | ✅ |
| T0.3 | Product owner approves R01–R33 (all defaults accepted) | ✅ |
| T0.4 | Write BUSINESS_RULES.md from the approved answers | ✅ |

## Implementation order and dependencies

```
Day1 setup ─▶ Day1 DB+auth ─▶ Day1 lobby UI
     │
     └─▶ Day2 cards/deck ─▶ Day3 combos/compare ─▶ Day4 turn/state reducer ─┐
                                   (needs R01–R09)      (needs R10–R16)         ▼
                     Day5 Edge Functions + RPC + Realtime ◀── Day1 DB ─────────┘
                                   │
                     Day6 scoring (R17–R22), history, RLS tests, reconnect
                                   │
                     Day7 E2E, build, deploy, beta check
```

The engine (Days 2–4) and the backend plumbing (Day 1) don't depend on each other.
Only Days 3–4 and 6 need rule approval, so **Day 1 can start before every rule is approved**.

---

## Day 1: Setup, Supabase, auth, migrations, lobby

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T1.1 | Vite + React + TS strict + Tailwind + shadcn/ui + Router + Zustand + Zod; ESLint, Prettier, Vitest | M | `npm run typecheck lint test build` all pass on an empty app |
| T1.2 | `supabase init`, local stack, `@engine` alias, `.env.example` (URL + anon key only) | S | `supabase start` works; no secret in any `VITE_*` var |
| T1.3 | Migrations 0001–0003 (tables, constraints, RLS, grants) | L | `supabase db reset` is clean; pgTAP: private-hand and no-write tests pass |
| T1.4 | Auth: Register/Login/Logout pages, protected routes, profile trigger | M | A new user gets a `profiles` row; protected pages redirect when signed out |
| T1.5 | Lobby shell (my active room, Create / Join buttons) | S | Renders for a signed-in user |

**Security risks:** RLS mistakes on the new tables. Mitigated by writing the pgTAP tests in the same task.

## Day 2: Card model, deck, shuffle, deal, card UI

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T2.1 | `cards.ts` encoding/parsing and rank values | S | Parse/format round-trips all 52 codes; rejects invalid codes |
| T2.2 | DeckFactory, DeckShuffler (injected RNG), CardDealer | S | Tests: 52 unique cards; shuffle is a permutation; seeded RNG is deterministic; deal gives `handSize` × 4 with no overlap |
| T2.3 | `GameRuleSet` type + `XAM_BASELINE_V1` constant (approved values only) | S | Unknown code/version is rejected |
| T2.4 | `<PlayingCard>`, `<Hand>` with selection (Zustand), sorted by rank | M | RTL tests: selecting/deselecting; displays 10 cards |

## Day 3: Combinations and comparison (needs R01–R09)

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T3.1 | CombinationValidator for the 5 types | M | Table-driven tests incl. A-2-3 and Q-K-A edges, invalid K-A-2, mixed suits |
| T3.2 | CombinationComparator `canBeat` (single source of comparison logic) | M | Tests: same type/size/higher rank; straight length mismatch; four of a kind vs a single 2; equal rank cannot beat |
| T3.3 | Property tests: `canBeat` is irreflexive and never true across different types (except the R09 bomb) | S | Pass over randomized inputs |

## Day 4: Turn manager, play/pass, local simulation (needs R10–R16)

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T4.1 | MoveValidator (turn, ownership, combination, beat, leader-cannot-pass) | M | One test per error code |
| T4.2 | TurnManager (CCW order, pass lock, round reset) | M | Tests: 3 passes → leader resets; locked seats are skipped |
| T4.3 | GameStateManager pure reducer + WinnerEvaluator | M | Tests: full scripted game to completion; the reducer never mutates its input |
| T4.4 | Dev-only "hot-seat" local table driven by the reducer (excluded from the production build) | S | Can play a 4-seat game locally |

## Day 5: Edge Functions, RPCs, Realtime, concurrency

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T5.1 | `_shared` http/auth/schemas/db helpers + error envelope | S | Unit tests for the error mapping |
| T5.2 | `create_room`/`join_room` RPCs + `create-room`/`join-room` functions | M | 4 users join one room; 5th → `ROOM_FULL`; rejoin → `ALREADY_IN_ROOM` |
| T5.3 | `start_match` RPC + `start-match` function (server shuffle and deal) | M | Only the host; exactly 4 players; each sees only their own hand |
| T5.4 | `apply_game_action` RPC + `play-cards`/`pass-turn` | L | Stale version → `VERSION_CONFLICT`; duplicate actionId → idempotent; **concurrency test: 20 parallel requests on the same version → exactly 1 commit** |
| T5.5 | Realtime private channels + `realtime.messages` policies; Waiting Room and Game Table wired to them | L | 4 browsers see state updates < 1 s; a non-member cannot subscribe |

**Security risks:** service key exposure, broadcast leaking hands. Checks: grep the bundle; inspect broadcast payloads in a test.

## Day 6: Scoring, history, RLS tests, reconnect (needs R17–R33)

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T6.1 | ScoreCalculator + results written inside `apply_game_action` | M | Unit tests per scoring rule; results persisted once |
| T6.2 | Match Result page, Profile, Match History | M | Shows the persisted results only, no client-side computation |
| T6.3 | Turn timeout (`claim-timeout`) and `finish-match` abort (if R27/R30 approved) | M | An expired turn auto-passes; an early claim → `TURN_NOT_EXPIRED` |
| T6.4 | Reconnect and refetch logic, connection badge | S | Kill the network mid-game → the state recovers on reconnect |
| T6.5 | Full pgTAP security suite (DATABASE §5) | M | All pass |

## Day 7: E2E, build, deploy, beta

| ID | Task | Cx | Acceptance criteria |
|----|------|----|--------------------|
| T7.1 | Playwright: 4 browser contexts, register → room → start → play to finish → result | L | Green locally against `supabase start` |
| T7.2 | Production build, Vercel config (SPA rewrites), `supabase db push`, deploy functions | M | Prod smoke test passes |
| T7.3 | README, API_SPEC.md, known limitations | S | Docs match the code |
| T7.4 | Private beta checklist with 4 real users | S | One full match on production, no errors in the logs |

## Known risks to the schedule

1. **Rule approval latency.** Days 3–4 stall without R01–R16. Mitigation: Day 1 doesn't need them.
2. **Realtime authorization** (private channels + RLS on `realtime.messages`) is the least familiar piece. Fallback: Postgres Changes on `matches` (RLS-filtered) + refetch.
3. **Concurrency test flakiness** on local Supabase. Keep the row lock + UNIQUE constraints as the hard guarantees.
4. If correctness conflicts with the 7-day deadline, correctness wins and the delay is recorded here.

---

## Progress log

### 2026-11-16 · Day 1 ✅
| Task | Status | Notes |
|------|--------|-------|
| T1.1 Tooling | ✅ | typecheck, lint, 25 unit tests, build pass; `npm run verify` also runs the bundle secret scan |
| T1.2 Supabase local | ✅ | Running without studio/analytics (`-x vector,logflare,imgproxy,studio`). Earlier blocker (drive C: full → Docker read-only) cleared by pruning 19 GB of Docker build cache |
| T1.3 Migrations 0001–0003 + pgTAP | ✅ | Applied cleanly; `supabase test db`: 60/60 pass. Grants double-checked in `pg_catalog` |
| T1.4 Auth | ✅ | Browser-verified: client validation, register → profile trigger → lobby, duplicate username refused by the trigger (no orphan auth user), wrong password message, logout, login |
| T1.5 Lobby shell | ✅ | Shows the profile via RLS. Create/Join buttons disabled until Day 5 |

Live security check with a real user token over REST: own score edit 403, room insert 403, hands read `[]`, own rename 204, anon read 401.

Known limitations: the Studio image is corrupted locally (excluded; not needed); the bundle is 652 kB (code splitting later); `npm audit` shows 7 moderate issues in dev dependencies (not yet looked into).

### 2026-11-16 · Day 2 ✅
| Task | Status | Notes |
|------|--------|-------|
| T2.1 `cards.ts` | ✅ | All 52 codes round-trip; 16 kinds of invalid input rejected; duplicates rejected by `parseCards` |
| T2.2 Deck, shuffle, deal | ✅ | `createDeck`, Fisher–Yates `shuffle(items, randomInt)`, `deal` (round-robin), `shuffleAndDeal`. RNGs: `seededRandomInt` (tests/replays) and `cryptoRandomInt` (unbiased, for the server). Tests cover permutation, determinism, no mutation, a uniformity check, 4×10 dealt + 12 undealt with no overlap |
| T2.3 Ruleset | ✅ | `XAM_BASELINE_V1` (deep-frozen), `getRuleset` rejects unknown code/version, `resolveRuleset` also rejects a known version whose values drifted. A test parses migration 0001 and asserts the DB row equals the constant |
| T2.4 `<PlayingCard>`, `<Hand>` | ✅ | Selection in Zustand (`features/game/selectionStore`), sorted by rank, Vietnamese labels for screen readers (e.g. "10 cơ"), `aria-pressed`, disabled state, drops selected cards that leave the hand. Dev-only preview at `/dev/cards` (not in the production bundle, checked) |

Tests: 127 unit tests (102 new). Browser-checked on `/dev/cards`: select/deselect, lock, remove, re-deal, fits a 375 px screen without horizontal scroll.

### 2026-11-16 · Day 3 ✅
| Task | Status | Notes |
|------|--------|-------|
| T3.1 CombinationValidator | ✅ | `classify(cards, ruleset)` in `combination.ts`. Table-driven tests for all 5 types, A-2-3 (lowest) and Q-K-A (highest), 2-3-4, 10-card straights; rejects K-A-2, Q-K-A-2, K-A-2-3, gaps, 11-card runs, consecutive pairs, empty and duplicate sets. Low straights are returned in A-2-3… display order |
| T3.2 CombinationComparator | ✅ | `canBeat(next, current, ruleset)` is the only comparison code. Straight key = top card with A = 1 in low runs. Four of a kind beats a single 2 only (not a pair of 2s), and a higher four beats a lower one |
| T3.3 Property tests | ✅ | Over ~470 random and all 68 possible straights plus every set: irreflexive, asymmetric, never crosses type/size except the R09 bomb, transitive within a type+size, independent of card order |

Note: `canBeat` is intentionally **not** transitive across types (four 3s beat a 2 and a 2 beats an A, but four 3s don't beat an A). A test documents it. No new dependency: property tests use the engine's seeded RNG.

Tests: 193 unit tests (66 new).

### 2026-11-16 · Day 4 ✅
| Task | Status | Notes |
|------|--------|-------|
| T4.1 MoveValidator | ✅ | `validateMove(state, action, ruleset)` → `Result`. Fixed check order: request shape → match active → turn → leader-cannot-pass → ownership → combination → beat. One test per error code, plus a test that the list of tested codes equals `MOVE_ERROR_CODES` |
| T4.2 TurnManager | ✅ | `seatAfter` (CCW 0→3→2→1), `nextActiveSeat` skips locked seats, `roundIsOver`, `chooseFirstLeader` (random, or previous winner) |
| T4.3 GameStateManager + WinnerEvaluator | ✅ | `createMatchState`, pure `applyAction` → `{ nextState, events }`, `findWinner`, plus `timeoutAction` (R27: pass, or the leader's lowest single) and `toPublicState` (card counts, no hands). Scripted game to completion; 150 seeded bot games all finish with cards conserved, and every step runs on a deep-frozen input to prove nothing is mutated |
| T4.4 Hot-seat table | ✅ | `/dev/table`, dev-only (checked: not in the production bundle). Browser-checked: leader pass refused, invalid combo refused, a full match to a winner, next match led by the previous winner |

Engine error codes (in `state.ts`, messages in `src/features/game/labels.ts`): `INVALID_REQUEST`, `MATCH_NOT_ACTIVE`, `NOT_YOUR_TURN`, `CARD_NOT_OWNED`, `INVALID_COMBINATION`, `CANNOT_BEAT_CURRENT_PLAY`, `LEADER_CANNOT_PASS`. The master prompt §13 list isn't in the repo, so the names not already in the docs were chosen here; rename in one place if they must match.

Tests: 236 unit tests (43 new).

### 2026-11-16 · Day 5 ✅
| Task | Status | Notes |
|------|--------|-------|
| T5.1 `_shared` helpers + error envelope | ✅ | `errors.ts` (one table of codes → HTTP status → Vietnamese message, `mapDbError`), `http.ts` (CORS, POST-only, envelope, no stack traces), `schemas.ts` (Zod), `auth.ts`, `db.ts`, `rpc.ts`. Unit tests for the error mapping, schemas and handler. `zod`/`supabase-js` resolve through `supabase/functions/deno.json` under Deno and from `node_modules` under Vitest |
| T5.2 Rooms | ✅ | Migration 0004 + `create-room`, `join-room`, `leave-room`. Integration: 4 users join seats 0..3; 5th → `ROOM_FULL`; rejoin → `ALREADY_IN_ROOM`; host handoff and close on empty (R33) |
| T5.3 `start-match` | ✅ | Crypto shuffle and deal in the function, validated in `start_match` (4 × handSize distinct valid cards, previous winner leads). Integration: only the host; exactly 4; each player reads only their own hand (RLS); the DEAL log has no cards |
| T5.4 `apply_game_action` + `play-cards`/`pass-turn` | ✅ | Stale version → `VERSION_CONFLICT`; same `actionId` → idempotent replay (`duplicate: true`); **20 parallel requests on one version → exactly 1 commit** (through the function and directly on the RPC); full match to a winner, next match led by the winner |
| T5.5 Realtime + pages | ✅ | Migration 0006 policies; RPCs broadcast after commit. Integration: all 4 members receive the state < 1 s, the payload holds no hand, outsiders and malformed topics get `CHANNEL_ERROR`. Waiting Room (`/room/:id`) and Game Table (`/match/:id`) wired with resync on (re)subscribe and tab focus; component tests pass. Browser check (4 accounts on 4 origins): register, create, join by lowercase code, the host's seat list fills in live, start moves all 4 tabs to the table, 40 distinct cards with each tab seeing only its own hand. A full match (27 versions) was then played with one seat by a person in the browser and three by a script through the real functions, while the host tab followed via Realtime only: winner and cóng shown, "Về phòng" returns to the same 4 seats |

Found and fixed while testing:
- `runAction` read the match row and the hands separately, so under concurrency it could see an old version with a new hand and answer `CARD_NOT_OWNED` instead of `VERSION_CONFLICT` (or instead of an idempotent replay). It now re-checks for its own committed action and for a moved version before reporting an engine error.
- The local edge runtime sometimes recycles a worker mid-request and answers with a raw 5xx. The client (`src/lib/functions.ts`) and the test helper retry once with the same body, which is safe because actions are idempotent.
- The local Auth limit of 30 sign-ins per 5 min made repeated integration runs fail; `supabase/config.toml` raises it **for the local stack only**.

Tests: `npm run verify` unit tests, 88 pgTAP assertions (28 new), 16 integration tests (`npm run test:integration`, needs the local stack), stable over 6 consecutive runs.
