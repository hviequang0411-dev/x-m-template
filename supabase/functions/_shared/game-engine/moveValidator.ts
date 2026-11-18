import { isCardCode, parseCards } from './cards.ts'
import { canBeat, classify, type Combination } from './combination.ts'
import type { GameRuleSet } from './ruleset.ts'
import { err, ok, type GameAction, type MatchState, type MoveErrorCode, type Result } from './state.ts'

export type ValidMove =
  | { readonly type: 'PLAY'; readonly combination: Combination }
  | { readonly type: 'PASS' }
  | { readonly type: 'DECLARE_SAM' }

/**
 * MoveValidator: is `action` legal in `state`? Checks run in a fixed order so each failure maps to
 * exactly one error code: request shape → match active → (DECLARE_SAM) pre-play check → turn
 * → (PASS) leader-cannot-pass → (PLAY) ownership → combination → beat.
 */
export function validateMove(
  state: MatchState,
  action: GameAction,
  ruleset: GameRuleSet,
): Result<ValidMove, MoveErrorCode> {
  const { seat } = action
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats.length) return err('INVALID_REQUEST')
  if (action.type !== 'PLAY' && action.type !== 'PASS' && action.type !== 'DECLARE_SAM') return err('INVALID_REQUEST')
  if (action.type === 'PLAY') {
    const cards: readonly unknown[] = Array.isArray(action.cards) ? action.cards : []
    if (cards.length === 0 || !cards.every(isCardCode) || new Set(cards).size !== cards.length)
      return err('INVALID_REQUEST')
  }

  if (state.status !== 'PLAYING') return err('MATCH_NOT_ACTIVE')

  if (action.type === 'DECLARE_SAM') {
    // Báo Xâm is only allowed before any card has been played in the match, and only once per match.
    if (state.samSeat != null || state.seats.some((s) => s.hasPlayed) || state.seats[seat]!.hand.length === 0)
      return err('INVALID_REQUEST')
    return ok({ type: 'DECLARE_SAM' })
  }

  if (seat !== state.currentSeat) return err('NOT_YOUR_TURN')

  if (action.type === 'PASS') {
    if (state.currentTrick === null && !ruleset.leaderCanPass) return err('LEADER_CANNOT_PASS')
    return ok({ type: 'PASS' })
  }

  const hand = state.seats[seat]!.hand
  if (!action.cards.every((c) => hand.includes(c))) return err('CARD_NOT_OWNED')

  const combination = classify(parseCards(action.cards), ruleset)
  if (!combination) return err('INVALID_COMBINATION')

  if (state.currentTrick && !canBeat(combination, state.currentTrick, ruleset))
    return err('CANNOT_BEAT_CURRENT_PLAY')

  return ok({ type: 'PLAY', combination })
}
