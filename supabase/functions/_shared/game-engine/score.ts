import { parseCards, sortCards, type CardCode, type Rank } from './cards.ts'
import type { GameRuleSet } from './ruleset.ts'
import type { MatchState } from './state.ts'

export interface Penalties {
  /** Never played a card: pays the flat cóng penalty instead of the card count [R18]. */
  readonly cong?: true
  /** Number of 2s still held (or played as final card). */
  readonly thoi2?: number
  /** Played a 2 as the final card and was penalized with a loss. */
  readonly thoi2Cuoi?: true
  /** Declared Báo Xâm and was blocked by another player (Đền Xâm). */
  readonly denSam?: true
  /** Ranks of four-of-a-kinds still held. Recorded only, not scored in v1 [R20]. */
  readonly thoiTuQuy?: readonly Rank[]
}

export interface SeatResult {
  readonly seat: number
  readonly isWinner: boolean
  readonly remainingHand: readonly CardCode[]
  readonly remainingCards: number
  readonly scoreDelta: number
  readonly penalties: Penalties
}

const SAM_PER_PLAYER = 20

/**
 * ScoreCalculator [R17–R20 + Báo Xâm & Thối 2 cuối].
 * - Normal win: each loser pays 1 point per card left, or 15 for cóng.
 * - SAM_SUCCESS: each loser pays 20 points to the Báo Xâm winner.
 * - SAM_CAUGHT: the blocked Báo Xâm player (`foulSeat`) pays 20 * (players - 1) to the blocker (`winnerSeat`).
 * - THOI_2_CUOI: the player who went out on a 2 (`foulSeat`) pays `congPenalty` (15) to `winnerSeat`.
 * The result always sums to zero.
 */
export function calculateScores(
  state: Pick<MatchState, 'status' | 'seats' | 'winnerSeat' | 'foulSeat' | 'endReason'>,
  ruleset: Pick<GameRuleSet, 'scoring'>,
): SeatResult[] {
  if (state.status !== 'FINISHED' || state.winnerSeat === null) throw new Error('MATCH_NOT_FINISHED')
  const winner = state.winnerSeat
  const { perCard, congPenalty, thoi2, thoiTuQuy } = ruleset.scoring

  // Foul finishes: THOI_2_CUOI (went out on a 2) or SAM_CAUGHT (Báo Xâm got blocked)
  if (
    (state.endReason === 'THOI_2_CUOI' || state.endReason === 'SAM_CAUGHT') &&
    state.foulSeat !== null &&
    state.foulSeat !== undefined
  ) {
    const foul = state.foulSeat
    const penaltyAmount =
      state.endReason === 'SAM_CAUGHT' ? SAM_PER_PLAYER * (state.seats.length - 1) : congPenalty

    return state.seats.map((s, seat) => {
      const cards = sortCards(parseCards(s.hand)).map((c) => c.code)
      if (seat === winner) {
        return {
          seat,
          isWinner: true,
          remainingHand: cards,
          remainingCards: cards.length,
          scoreDelta: penaltyAmount,
          penalties: {},
        }
      }
      if (seat === foul) {
        return {
          seat,
          isWinner: false,
          remainingHand: cards,
          remainingCards: cards.length,
          scoreDelta: -penaltyAmount,
          penalties:
            state.endReason === 'SAM_CAUGHT'
              ? { denSam: true }
              : { thoi2: 1, thoi2Cuoi: true },
        }
      }
      return {
        seat,
        isWinner: false,
        remainingHand: cards,
        remainingCards: cards.length,
        scoreDelta: 0,
        penalties: {},
      }
    })
  }

  if (state.seats[winner]?.hand.length !== 0) throw new Error('WINNER_HAS_CARDS')

  const losers = state.seats.map((s, seat) => {
    if (seat === winner) return null
    const cards = sortCards(parseCards(s.hand))
    const twos = cards.filter((c) => c.rank === '2').length
    const counts = new Map<Rank, number>()
    for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
    const quads = [...counts].filter(([, n]) => n === 4).map(([r]) => r)

    const cong = !s.hasPlayed
    const base =
      state.endReason === 'SAM_SUCCESS'
        ? SAM_PER_PLAYER
        : cong
          ? congPenalty
          : perCard * cards.length
    const extra = state.endReason === 'SAM_SUCCESS' ? 0 : thoi2 * twos + thoiTuQuy * quads.length
    const penalties: Penalties = {
      ...(cong ? { cong: true as const } : {}),
      ...(twos ? { thoi2: twos } : {}),
      ...(quads.length ? { thoiTuQuy: quads } : {}),
    }
    return { seat, cards: cards.map((c) => c.code), pays: base + extra, penalties }
  })

  const total = losers.reduce((sum, l) => sum + (l?.pays ?? 0), 0)
  return state.seats.map((_, seat) => {
    const l = losers[seat]
    if (!l) return { seat, isWinner: true, remainingHand: [], remainingCards: 0, scoreDelta: total, penalties: {} }
    return {
      seat,
      isWinner: false,
      remainingHand: l.cards,
      remainingCards: l.cards.length,
      scoreDelta: -l.pays,
      penalties: l.penalties,
    }
  })
}
