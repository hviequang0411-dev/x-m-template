import type { RandomInt } from './rng.ts'

/**
 * What turn order needs: how many seats the MATCH has (2–4 under v2, always 4 under v1) and the
 * direction from the ruleset. Seats are numbered 0..players-1.
 */
export interface TurnRules {
  readonly players: number
  readonly direction: 'CCW' | 'CW'
}

/** The seat after `seat` in play order. CCW: 0 → n-1 → … → 1 → 0 [R12]. */
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
  rules: { readonly players: number },
  randomInt: RandomInt,
  previousWinnerSeat: number | null = null,
): number {
  if (previousWinnerSeat !== null && previousWinnerSeat >= 0 && previousWinnerSeat < rules.players) return previousWinnerSeat
  return randomInt(rules.players)
}
