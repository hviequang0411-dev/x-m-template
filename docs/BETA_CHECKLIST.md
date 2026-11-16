# Private beta checklist (T7.4)

Goal: one full match on production with 4 real people, and no errors in the logs.

## Before inviting anyone
- [ ] [DEPLOYMENT.md](DEPLOYMENT.md) steps 1–3 done; `node scripts/smoke.mjs …` passes against production.
- [ ] Auth Site URL / Redirect URLs point at the production app.
- [ ] You can register, log in and log out on production yourself (desktop and phone).
- [ ] Tell testers: points have **no monetary value** (R22); the app is a test build; report problems with a screenshot and the time.

## The session (4 people, about 30 minutes)
- [ ] All 4 register (or log in) on their own device.
- [ ] Host creates a room, shares the 6-character code; 3 others join. Every waiting room shows 4 names and green online dots.
- [ ] Host starts. Everyone sees 10 cards; only one person sees "Đến lượt bạn".
- [ ] Try the rules at least once each: a pair, a triple, a straight, passing, a round reset, four of a kind on a single 2 (if dealt).
- [ ] Someone tries an illegal play → a Vietnamese error appears, nothing changes.
- [ ] One person waits more than 30 s on their turn → the turn is taken automatically.
- [ ] One person turns Wi-Fi off for ~20 s mid-game, then on → badge shows "Mất mạng"/"Đang kết nối lại…", then the table catches up.
- [ ] Play to the end. All 4 see the same result table; scores match the rules (1 point per card, cóng 15).
- [ ] Everyone opens Lịch sử and Hồ sơ: the match and totals are there.
- [ ] "Về phòng" → same 4 seats; host starts a second match; the previous winner leads.
- [ ] A 5th person joins during the match → sees "Bạn đang xem ván này", no cards; gets a seat when it ends (R37).
- [ ] Host starts a 2-player match; and a practice match with "Thêm máy" (bots play by themselves; no points change) (R01b, R36).
- [ ] Header shows each player's points; someone under 10 points blocks a ranked start (R34).
- [ ] Admin: add points with a reason to the player at 0, lock and unlock a test account (R38).

## After the session
- [ ] Supabase dashboard → Edge Functions → logs: no `INTERNAL_ERROR`, no unexpected 5xx.
- [ ] Postgres logs: no errors from `apply_game_action`.
- [ ] `select count(*) from match_results where match_id = '<id>'` = 4, and `sum(score_delta)` = 0.
- [ ] Collect feedback: confusing screens, rule disagreements (→ RULE_DECISIONS, new ruleset version), bugs.

## Known limitations to tell testers
- Leaving the room during a match isn't possible yet (R29); just close the tab, and your turns auto-pass after 30 s.
- A match can only be aborted by the host after 5 minutes without a move (no voting yet).
- Special rules (báo sâm, đền, instant wins, chặt chồng) are off in v1.
