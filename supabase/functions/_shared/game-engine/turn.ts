import type { RandomInt } from './rng.ts'
import type { GameRuleSet } from './ruleset.ts'

type TurnRules = Pick<GameRuleSet, 'players' | 'direction'>

/** The seat after `seat` in play order. CCW: 0 → 3 → 2 → 1 → 0 [R12]. */
export function seatAfter(seat: number, rules: TurnRules): number {
  const n = rules.players
  return rules.direction === 'CCW' ? (seat + n - 1) % n : (seat + 1) % n
}

/**
 * TurnManager: the next seat after `from` that isn't locked out [R10, "locked seats are skipped"].
 * Returns null when every other seat is locked, which means the round resets [R11].
 */
export function nextActiveSeat(from: number, passedSeats: readonly number[], rules: TurnRules): number | null {
  let seat = seatAfter(from, rules)
  for (let i = 0; i < rules.players - 1; i++) {
    if (!passedSeats.includes(seat)) return seat
    seat = seatAfter(seat, rules)
  }
  return null
}

/** True when everyone except the round owner has passed, so the round resets [R11]. */
export function roundIsOver(leadSeat: number, passedSeats: readonly number[], rules: TurnRules): boolean {
  for (let s = 0; s < rules.players; s++) if (s !== leadSeat && !passedSeats.includes(s)) return false
  return true
}

/** First match in a room: a random seat leads [R13]. Later matches: the previous winner [R14]. */
export function chooseFirstLeader(
  rules: Pick<GameRuleSet, 'players'>,
  randomInt: RandomInt,
  previousWinnerSeat: number | null = null,
): number {
  return previousWinnerSeat ?? randomInt(rules.players)
}
