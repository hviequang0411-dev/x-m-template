# BUSINESS RULES — Xam Online

Rulesets: **`xam-baseline` v2** (current, APPROVED 2026-11-17) and v1 (APPROVED 2026-11-16, kept for old matches) · Source: [RULE_DECISIONS.md](RULE_DECISIONS.md) (IDs in brackets)

Sections 1–8 describe v1; **section 9 lists what v2 changes**. New rooms use v2.

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

## 9. Ruleset v2 changes (APPROVED 2026-11-17) [R01b, R34–R38]
27. **2–4 players.** The host may start once at least 2 players are seated (rule 1 said exactly 4). Everyone still gets 10 cards; the rest are discarded unseen. Seats are numbered 0…n−1 for the match, and play is counter-clockwise over those seats. [R01b]
28. **Points balance.** A profile's points are a balance: new accounts start with **10**. A ranked match can start only if **every** player has at least 10 points. [R34]
29. **Scoring unchanged, but capped.** Losers still owe 1 point per card left, or 15 for cóng. Nobody pays more than their balance: a loser with fewer points than they owe pays everything they have, and the winner receives the total actually paid. Balances never go below 0. [R35]
30. **Bots.** The host can add bots ("máy") to free seats while the room is waiting, and remove them. The server plays a bot's turn about 0.8 s after it becomes its turn. **A match with any bot is a practice match**: no points change, no 10-point requirement, no results or history. [R36]
31. **Waiting members.** Someone who joins while a match is being played, or when all 4 seats are taken, joins as a **waiting member**: they can watch the public table (card counts, plays; never hands) and take free seats in join order when the room is waiting again. A room holds at most 8 members. Waiting members may leave at any time. [R37]
32. **Admins.** Accounts marked as admin in the database can list accounts, add or remove points (always with a logged reason; never below 0) and lock/unlock accounts. Locked accounts can't create, join or start rooms. Points still have no monetary value (rule 19): they are never bought, sold or transferred. [R38]
