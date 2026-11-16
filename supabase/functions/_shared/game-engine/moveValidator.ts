import { isCardCode, parseCards } from './cards.ts'
import { canBeat, classify, type Combination } from './combination.ts'
import type { GameRuleSet } from './ruleset.ts'
import { err, ok, type GameAction, type MatchState, type MoveErrorCode, type Result } from './state.ts'

export type ValidMove = { readonly type: 'PLAY'; readonly combination: Combination } | { readonly type: 'PASS' }

/**
 * MoveValidator: is `action` legal in `state`? Checks run in a fixed order so each failure maps to
 * exactly one error code: request shape → match active → turn → (PASS) leader-cannot-pass
 * → (PLAY) ownership → combination → beat.
 */
export function validateMove(
  state: MatchState,
  action: GameAction,
  ruleset: GameRuleSet,
): Result<ValidMove, MoveErrorCode> {
  const { seat } = action
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats.length) return err('INVALID_REQUEST')
  if (action.type !== 'PLAY' && action.type !== 'PASS') return err('INVALID_REQUEST')
  if (action.type === 'PLAY') {
    const cards: readonly unknown[] = Array.isArray(action.cards) ? action.cards : []
    if (cards.length === 0 || !cards.every(isCardCode) || new Set(cards).size !== cards.length)
      return err('INVALID_REQUEST')
  }

  if (state.status !== 'PLAYING') return err('MATCH_NOT_ACTIVE')
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
