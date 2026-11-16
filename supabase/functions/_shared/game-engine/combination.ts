import { compareCardsForDisplay, type Card, type CardCode, type Rank } from './cards.ts'
import type { GameRuleSet } from './ruleset.ts'

/** The five allowed combination types [R07]. Names match the `game_actions.combination` check. */
export const COMBINATION_TYPES = ['SINGLE', 'PAIR', 'TRIPLE', 'STRAIGHT', 'FOUR_OF_A_KIND'] as const
export type CombinationType = (typeof COMBINATION_TYPES)[number]

export interface Combination {
  readonly type: CombinationType
  /** Number of cards. */
  readonly size: number
  /**
   * What `canBeat` compares [R06, R08].
   * SINGLE/PAIR/TRIPLE/FOUR_OF_A_KIND: the card value (3..15, 2 = 15).
   * STRAIGHT: the top card, with A = 1 and 2 = 2 in a low straight (A-2-3 → 3), A = 14 in a high one.
   */
  readonly keyRank: number
  /** The cards, in display order. */
  readonly cards: readonly CardCode[]
}

type StraightRules = Pick<GameRuleSet, 'straight'>

/** Rank positions in a LOW straight: A-2-3-…-K (A = 1, 2 = 2). */
const LOW_POSITION: Readonly<Record<Rank, number>> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13,
}
/** Rank positions in a HIGH straight: 3-…-K-A (2 not allowed). */
const HIGH_POSITION: Readonly<Partial<Record<Rank, number>>> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
}

/** Returns the top position if the positions form one consecutive run, else null. */
function topOfRun(positions: readonly (number | undefined)[]): number | null {
  if (positions.some((p) => p === undefined)) return null
  const sorted = (positions as number[]).slice().sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]! + 1) return null
  return sorted[sorted.length - 1]!
}

/**
 * Straight key rank, or null [R04, R05]. Ranks must be distinct and consecutive either
 * as a low run (A-2-3…, 2-3-4…) or a high run (…-Q-K-A). 2 never sits above K, and there is
 * no wraparound, so K-A-2 and Q-K-A-2 are invalid.
 */
function straightKey(cards: readonly Card[], rules: StraightRules): number | null {
  const { min, max } = rules.straight
  if (cards.length < min || cards.length > max) return null
  if (new Set(cards.map((c) => c.rank)).size !== cards.length) return null
  const low = topOfRun(cards.map((c) => LOW_POSITION[c.rank]))
  const high = topOfRun(cards.map((c) => HIGH_POSITION[c.rank]))
  // Without A or 2 both runs agree. With A, at most one can be valid.
  return high ?? low
}

/**
 * CombinationValidator: classifies a set of cards, or returns null when it isn't one of the five
 * allowed combinations (including empty sets and duplicate cards). Suits never matter [R03].
 */
export function classify(cards: readonly Card[], ruleset: StraightRules): Combination | null {
  const n = cards.length
  if (n === 0) return null
  if (new Set(cards.map((c) => c.code)).size !== n) return null
  const ordered = cards.slice().sort(compareCardsForDisplay)
  const codes = ordered.map((c) => c.code)
  const first = ordered[0]!
  const sameRank = ordered.every((c) => c.rank === first.rank)

  if (sameRank) {
    const type: CombinationType | undefined = (
      { 1: 'SINGLE', 2: 'PAIR', 3: 'TRIPLE', 4: 'FOUR_OF_A_KIND' } as const
    )[n as 1 | 2 | 3 | 4]
    return type ? { type, size: n, keyRank: first.value, cards: codes } : null
  }

  const key = straightKey(ordered, ruleset)
  if (key === null) return null
  // Show low straights as A-2-3… rather than 3…A-2.
  const display = key < 14 && ordered.some((c) => c.rank === 'A' || c.rank === '2')
    ? ordered.slice().sort((a, b) => LOW_POSITION[a.rank] - LOW_POSITION[b.rank]).map((c) => c.code)
    : codes
  return { type: 'STRAIGHT', size: n, keyRank: key, cards: display }
}

const TWO_VALUE = 15

/**
 * CombinationComparator: can `next` be played on top of `current`?
 * **The only place comparison logic lives** [R06, R08, R09].
 * - Same type and size, strictly higher key rank. Equal never beats [R03].
 * - Four of a kind also beats a single 2 [R09]. Nothing else crosses types.
 */
export function canBeat(
  next: Combination,
  current: Combination,
  ruleset: Pick<GameRuleSet, 'fourOfAKindBeats'>,
): boolean {
  if (next.type === current.type && next.size === current.size) return next.keyRank > current.keyRank
  if (
    ruleset.fourOfAKindBeats === 'SINGLE_TWO' &&
    next.type === 'FOUR_OF_A_KIND' &&
    current.type === 'SINGLE' &&
    current.keyRank === TWO_VALUE
  )
    return true
  return false
}
