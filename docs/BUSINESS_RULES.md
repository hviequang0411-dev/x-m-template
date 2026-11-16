# BUSINESS RULES — Xam Online

Ruleset: **`xam-baseline` v1** · Status: **APPROVED 2026-11-16** · Source: [RULE_DECISIONS.md](RULE_DECISIONS.md) (IDs in brackets)

This is the top-priority source of truth. Any change requires a new ruleset version.

## 1. Setup
1. Standard 52-card deck, exactly 4 players per match. [R01]
2. Each player is dealt **10 cards**. The 12 remaining cards are discarded unseen. [R01]
3. Shuffling uses a cryptographically secure RNG on the server.

## 2. Card ranking
4. Rank order, low to high: **3 4 5 6 7 8 9 10 J Q K A 2**. [R02]
5. **Suits never matter.** A card or combination must have a *strictly higher* rank to beat another; equal rank never beats. [R03]

## 3. Combinations [R07]
| Type | Definition |
|------|-----------|
| SINGLE | 1 card |
| PAIR | 2 cards of the same rank |
| TRIPLE | 3 cards of the same rank |
| STRAIGHT | 3–10 cards of consecutive rank, suits mixed [R04] |
| FOUR_OF_A_KIND | 4 cards of the same rank |

Straight rules [R05]:
- The ace can be **low** (A-2-3-…) or **high** (…-Q-K-A), never both in the same straight.
- 2 can appear only in a low straight that starts with A-2 or 2-3 (e.g. A-2-3, 2-3-4, A-2-3-4-5).
- No wraparound: K-A-2 and Q-K-A-2 are invalid.
- Ordering: A-2-3 is the lowest 3-card straight, Q-K-A the highest.

## 4. Beating [R06, R08, R09]
6. A play beats the current trick if it has the **same type and the same number of cards** and a **strictly higher key rank**.
   - Key rank: the rank of the set for SINGLE/PAIR/TRIPLE/FOUR_OF_A_KIND; the **top card** for STRAIGHT (A counts as 1 in a low straight, so A-2-3 tops out at 3).
7. **Four of a kind** also beats a **single 2**. A higher four of a kind beats a lower one. Nothing else crosses types.

## 5. Turns [R10–R16]
8. Play is **counter-clockwise**: seat order 0 → 3 → 2 → 1 → 0. [R12]
9. First match in a room: a **random** seat leads. Later matches: the **previous winner** leads. [R13, R14]
10. The leader of a fresh round plays any valid combination and **cannot pass**. [R16]
11. Other players must beat the current trick or **PASS**. A player who passes is **locked out until the round resets**. [R10]
12. When every other player still in the round has passed, the round resets: the trick clears and the last player who played leads. [R11]
13. Locked-out seats are skipped when finding the next turn.

## 6. End of match and scoring [R15, R17–R22]
14. The match ends **immediately** when a player plays their last card. That player wins; the other three lose. [R15]
15. Going out with a 2 or a four of a kind is allowed. [R21]
16. Each loser pays **1 point per card left** in hand to the winner. [R17]
17. **Cóng**: a loser who never played a card pays a flat **15 points** instead. [R18]
18. Thối 2 and thối tứ quý are recorded but not scored in v1. [R19, R20]
19. Points have **no monetary value**. No wagering, purchase or transfer of points. [R22]

## 7. Deferred (flags off in v1) [R23–R26]
Báo Sâm, báo 1 + đền, instant wins (tới trắng), chain bombing (chặt chồng).

## 8. Product rules [R27–R33]
20. **Turn timeout 30 s.** When it expires the player auto-PASSes; if they are the leader, the server auto-plays their lowest single. Any member may trigger `claim-timeout` after the deadline. [R27]
21. A disconnected player keeps their seat; the timer keeps running. Reconnecting restores the authoritative state. [R28]
22. Leaving mid-match is a forfeit, scored as cóng; the seat auto-passes for the rest of the match. [R29]
23. `finish-match` only **aborts** a match (host, with all players agreeing or after a 5-minute stall). It never declares a winner. [R30]
24. After a match the room returns to WAITING with the same seats. [R31]
25. Rooms are private and joined by a 6-character code. There is no public room list. [R32]
26. A room is CLOSED by the host or after 30 minutes with no members. If the host leaves, the lowest occupied seat becomes host. [R33]
