# RULE DECISIONS — Xam Online

Status: **APPROVED 2026-11-16 (all proposed defaults accepted)** · Ruleset candidate: `xam-baseline` v1 · Last updated: 2026-11-16

## Why this document exists

The master prompt names `docs/BUSINESS_RULES.md` as the top-priority source of truth.
**That file does not exist in the repository**, so there are currently **zero approved rules**.

This document lists every rule the game engine needs, proposes a default for each,
and marks it `PENDING`. Nothing marked `PENDING` will be implemented as a confirmed rule.
Once the product owner approves, the approved answers become `docs/BUSINESS_RULES.md`
and are encoded in the `game_rulesets` table as `xam-baseline` v1.

The proposed defaults follow the common Vietnamese **Sâm Lốc** convention
(10-card hands, suits don't matter, the first player to go out ends the match).
Regional variants differ widely, which is why every item needs an explicit answer.

### How to approve

For each row, reply with the ID and `OK` (accept the proposed default), an option letter,
or your own rule, e.g. `R01 OK, R03 B, R12 defer`.

Legend: **Blocks** = earliest sprint day that cannot be completed without the answer.

---

## A. Critical: blocks the core engine (Day 2–4)

| ID | Topic | Options | Proposed default | Blocks | Status |
|----|-------|---------|------------------|--------|--------|
| R01 | **Cards dealt per player** | A) 10 (Sâm) · B) 13 (Tiến Lên style) | **A: 10 cards each.** The 12 undealt cards are discarded unseen. | Day 2 | APPROVED |
| R02 | **Rank order** | A) 3 < 4 < … < K < A < 2 · B) other | **A.** 2 is the highest single. | Day 3 | APPROVED |
| R03 | **Do suits matter?** | A) No: same rank never beats same rank · B) Yes: suit order breaks ties (♠<♣<♦<♥) | **A: suits are ignored.** A play must have a strictly higher rank. | Day 3 | APPROVED |
| R04 | **Straight (sảnh) length** | min 3, max 10 (whole hand) | **Min 3, max 10.** Suits can be mixed. | Day 3 | APPROVED |
| R05 | **Where A and 2 can sit in a straight** | A) A-2-3… allowed as the lowest, Q-K-A as the highest, no wraparound (K-A-2 invalid) · B) 2 can never be in a straight · C) wraparound allowed | **A.** A-2-3 is the lowest 3-card straight; Q-K-A is the highest; K-A-2 and K-A-2-3 are invalid. | Day 3 | APPROVED |
| R06 | **Beating a straight** | Same length, higher top card | **Same length only, compared by top card** (with A counted low in A-2-3…). | Day 3 | APPROVED |
| R07 | **Allowed combinations** | SINGLE, PAIR, TRIPLE, STRAIGHT, FOUR_OF_A_KIND | **These five only.** No consecutive pairs (đôi thông) in v1. | Day 3 | APPROVED |
| R08 | **Normal beating rule** | Same type, same size, strictly higher rank | **Yes.** | Day 3 | APPROVED |
| R09 | **Four of a kind (tứ quý) as a bomb** | A) beats one single 2 only · B) beats a single 2 or a pair of 2s · C) no bomb power | **A: beats a single 2.** A higher four of a kind beats a lower one. Otherwise it plays like any other combination. | Day 3 | APPROVED |
| R10 | **Passing locks you out of the round** | A) Yes, until the round resets · B) No, you can come back in | **A: locked out until the round resets.** | Day 4 | APPROVED |
| R11 | **Round reset** | The last player to play leads after everyone else passes | **Yes.** The current trick clears and that player leads any combination. | Day 4 | APPROVED |
| R12 | **Turn direction** | A) Counter-clockwise (Vietnamese convention) · B) Clockwise | **A: counter-clockwise** (seat 0 → 3 → 2 → 1). | Day 4 | APPROVED |
| R13 | **Who leads the first match** | A) Random seat (server RNG) · B) The host · C) Holder of the lowest card | **A: random seat.** | Day 4 | APPROVED |
| R14 | **Who leads later matches in the same room** | A) Winner of the previous match · B) Random | **A: previous winner.** | Day 4 | APPROVED |
| R15 | **When the match ends** | A) As soon as the first player empties their hand (Sâm) · B) Play on until all are ranked (Tiến Lên) | **A: the first player out wins; everyone else loses.** | Day 4 | APPROVED |
| R16 | **Leader must play** | The leader may not pass on a fresh round | **Yes, the leader cannot pass.** | Day 4 | APPROVED |

## B. Scoring and penalties (blocks Day 6)

| ID | Topic | Options | Proposed default | Status |
|----|-------|---------|------------------|--------|
| R17 | **Base score** | Each loser pays 1 point per card left in hand to the winner | **Yes.** The winner gets the sum. | APPROVED |
| R18 | **Cóng** (a loser never played a card) | A) Fixed penalty of 15 · B) 20 · C) No special penalty | **A: 15 points** instead of the card count. | APPROVED |
| R19 | **Thối 2** (loser still holds 2s) | A) +N points per 2 held · B) None | **Defer to v2** (record it, don't score it). | APPROVED |
| R20 | **Thối tứ quý** (loser still holds a four of a kind) | A) +N points · B) None | **Defer to v2.** | APPROVED |
| R21 | **Last card restriction** (can you go out on a 2?) | A) Allowed · B) Not allowed / counts as thối | **A: allowed in v1.** | APPROVED |
| R22 | **Currency** | Points only, no money, no wagering | **Points only. No real-money value, no purchase or transfer of points.** (Legal and gambling risk; not optional.) | APPROVED |

## C. Special rules (proposed: DEFER past the MVP, behind ruleset flags set to off)

| ID | Rule | Notes | Proposed | Status |
|----|------|-------|----------|--------|
| R23 | **Báo Sâm** (declare before play that you'll go out uninterrupted) | Needs a declaration phase, a block (chặn) check, and win/penalty scoring (e.g. ±20/player). | **Defer.** The flag `baoSam=false` exists in the ruleset. | APPROVED |
| R24 | **Báo 1 + đền** (when the next player has 1 card left, you must play your highest single or pay for everyone) | Card counts are always public, so the "announce" part is automatic. Enforcing đền needs hand-aware validation. | **Defer đền.** Show the "1 card" badge in the UI only. | APPROVED |
| R25 | **Instant wins (tới trắng)**: four 2s, 5 pairs, 3 triples, 10-card straight, 10 cards of one colour | Checked right after the deal. | **Defer.** | APPROVED |
| R26 | **Chặt chồng** (chain bombing) and bomb scoring | Depends on R09. | **Defer** (only the plain R09 behaviour in v1). | APPROVED |

## D. Product and operations rules (blocks Day 5–6)

| ID | Topic | Proposed default | Status |
|----|-------|------------------|--------|
| R27 | **Turn timeout** | 30 s per turn. When it runs out the player auto-PASSes; if they are the leader, the server auto-plays their lowest single. Done server-side through a `claim-timeout` call that any member can trigger once the deadline has passed. | APPROVED |
| R28 | **Disconnect** | The seat is kept; the turn timer keeps running (R27). The player can reconnect and pick up the authoritative state. | APPROVED |
| R29 | **Leaving mid-match** | Counts as a forfeit: scored as cóng (R18). The match continues with auto-pass on that seat. | APPROVED |
| R30 | **What `finish-match` is for** | Not for declaring a winner (the server detects that inside `play-cards`). Used only by the host to **abort** a match (all players must agree, or the match has been stalled > 5 min), and by the system to finalise results. | APPROVED |
| R31 | **After a match** | The room goes back to `WAITING` with the same seats; the host can start the next match. | APPROVED |
| R32 | **Lobby visibility** | Private rooms only: joined by 6-character code, no public room list. | APPROVED |
| R33 | **Room close** | The room is `CLOSED` when the host closes it or after 30 min with no members. Host leaves → host passes to the lowest occupied seat. | APPROVED |

---

## E. Ruleset v2 (requested 2026-11-17, approved 2026-11-17)

| ID | Topic | Decision | Status |
|----|-------|----------|--------|
| R01b | **Player count** | Replaces "exactly 4" in R01 for v2: a match may start with **2–4** seated players. 10 cards each. | APPROVED |
| R34 | **Minimum points** | New accounts start with **10 points**; every player needs ≥ 10 points to start a **ranked** match. | APPROVED |
| R35 | **Paying more than you have** | R17/R18 amounts are kept (1/card, cóng 15) but a loser pays at most their balance; the winner gets what was actually paid. Balances never go below 0. | APPROVED |
| R36 | **Playing against bots** | The host adds bots to free seats. Matches with a bot are **unranked**: no points, no 10-point requirement, no history. | APPROVED |
| R37 | **Joining late / full room** | Late joiners and members beyond 4 seats **wait** (watch the public table), and take free seats in join order when the room is waiting. Max 8 members. | APPROVED |
| R38 | **Admin** | `profiles.is_admin` set by SQL only. Admins list/search accounts, adjust points with a logged reason, lock/unlock accounts. No admin can lock themselves. | APPROVED |

## Conflicts and gaps found in the source documents

| # | Issue | Proposed resolution |
|---|-------|---------------------|
| C1 | `PRD.md`, `BUSINESS_RULES.md`, `GAME_ENGINE.md`, `API_SPEC.md`, `DEVELOPMENT_PLAN.md`, `ARCHITECTURE.md` and `DATABASE.md` are all referenced but **none exist**. | This analysis creates `ARCHITECTURE.md`, `DATABASE.md` and `DEVELOPMENT_TASKS.md` as drafts. `BUSINESS_RULES.md` is written from the approved answers here. The PRD content is taken from master prompt §10–11 unless you have a PRD to add. |
| C2 | The master prompt requires "handle player finishing" **and** "match completion" as separate steps, which suggests ranking all players (Tiến Lên). Sâm ends at the first finisher. | Decided by R15. |
| C3 | The `finish-match` endpoint conflicts with "client must never decide the winner". | R30: abort/finalise only, never a winner claim. |
| C4 | `FOUR_OF_A_KIND` is required, but its interaction with 2s is unspecified. | R09. |
| C5 | There is no turn-timeout requirement, yet a 4-player real-time game with no timeout can be stalled forever by one idle player. | R27 (adds a `claim-timeout` function and the error code `TURN_NOT_EXPIRED`). |
| C6 | The error code list lacks codes for timeout, a leader passing, and validation failures. | Add `TURN_NOT_EXPIRED`, `LEADER_CANNOT_PASS`, `INVALID_REQUEST`, `ALREADY_IN_ROOM`, `NOT_ENOUGH_PLAYERS`, `INTERNAL_ERROR`. |
