import { parseCards, sortCards, type CardCode, type Rank } from './cards.ts'
import type { GameRuleSet } from './ruleset.ts'
import type { MatchState } from './state.ts'

export interface Penalties {
  /** Never played a card: pays the flat cóng penalty instead of the card count [R18]. */
  readonly cong?: true
  /** Number of 2s still held. Recorded only, not scored in v1 [R19]. */
  readonly thoi2?: number
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

/**
 * ScoreCalculator [R17–R20]. Each loser pays the winner 1 point per card left, or the flat cóng
 * penalty if they never played. Thối 2 / thối tứ quý are recorded but score 0 in v1
 * (`scoring.thoi2 = 0`, `scoring.thoiTuQuy = 0`). The result always sums to zero.
 */
export function calculateScores(
  state: Pick<MatchState, 'status' | 'seats' | 'winnerSeat'>,
  ruleset: Pick<GameRuleSet, 'scoring'>,
): SeatResult[] {
  if (state.status !== 'FINISHED' || state.winnerSeat === null) throw new Error('MATCH_NOT_FINISHED')
  const winner = state.winnerSeat
  if (state.seats[winner]?.hand.length !== 0) throw new Error('WINNER_HAS_CARDS')
  const { perCard, congPenalty, thoi2, thoiTuQuy } = ruleset.scoring

  const losers = state.seats.map((s, seat) => {
    if (seat === winner) return null
    const cards = sortCards(parseCards(s.hand))
    const twos = cards.filter((c) => c.rank === '2').length
    const counts = new Map<Rank, number>()
    for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
    const quads = [...counts].filter(([, n]) => n === 4).map(([r]) => r)

    const cong = !s.hasPlayed
    const base = cong ? congPenalty : perCard * cards.length
    const extra = thoi2 * twos + thoiTuQuy * quads.length
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
