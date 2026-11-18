import { parseCards, sortCards, type CardCode } from './cards.ts'
import { validateMove } from './moveValidator.ts'
import type { GameRuleSet } from './ruleset.ts'
import {
  ok,
  type GameAction,
  type GameEvent,
  type MatchEndReason,
  type MatchState,
  type MoveErrorCode,
  type Result,
  type SeatState,
} from './state.ts'
import { nextActiveSeat, roundIsOver, seatAfter } from './turn.ts'

const TWO_RANK_VALUE = 15

/** A fresh match: `hands[seat]` from the dealer, `leadSeat` from `chooseFirstLeader`. */
export function createMatchState(hands: readonly (readonly CardCode[])[], leadSeat: number): MatchState {
  if (!Number.isInteger(leadSeat) || leadSeat < 0 || leadSeat >= hands.length)
    throw new RangeError(`leadSeat ${leadSeat} out of range`)
  return {
    status: 'PLAYING',
    seats: hands.map((hand) => ({ hand: [...hand], hasPlayed: false })),
    currentSeat: leadSeat,
    leadSeat,
    currentTrick: null,
    passedSeats: [],
    winnerSeat: null,
    samSeat: null,
    foulSeat: null,
    endReason: null,
  }
}

/** WinnerEvaluator: returns `winnerSeat` if already decided, else the seat with an empty hand. */
export function findWinner(state: Pick<MatchState, 'seats'> & { readonly winnerSeat?: number | null }): number | null {
  if (state.winnerSeat !== undefined && state.winnerSeat !== null) return state.winnerSeat
  const i = state.seats.findIndex((s) => s.hand.length === 0)
  return i === -1 ? null : i
}

export interface Transition {
  readonly nextState: MatchState
  readonly events: readonly GameEvent[]
}

/**
 * GameStateManager: a pure reducer. Validates the action, then returns a NEW state and the events
 * it produced. The input state is never mutated.
 */
export function applyAction(
  state: MatchState,
  action: GameAction,
  ruleset: GameRuleSet,
): Result<Transition, MoveErrorCode> {
  const valid = validateMove(state, action, ruleset)
  if (!valid.ok) return valid
  const seat = action.seat
  // Turn order runs over the seats this match actually has (2–4).
  const turns = { players: state.seats.length, direction: ruleset.direction }

  // Báo Xâm: the declarer immediately takes the lead before any card is played.
  if (valid.value.type === 'DECLARE_SAM') {
    const events: GameEvent[] = [{ type: 'SAM_DECLARED', seat }]
    return ok({
      nextState: {
        ...state,
        samSeat: seat,
        currentSeat: seat,
        leadSeat: seat,
        currentTrick: null,
        passedSeats: [],
      },
      events,
    })
  }

  if (valid.value.type === 'PASS') {
    const passedSeats = [...state.passedSeats, seat]
    const events: GameEvent[] = [{ type: 'PASSED', seat }]
    if (roundIsOver(state.leadSeat, passedSeats, turns)) {
      events.push({ type: 'ROUND_RESET', leadSeat: state.leadSeat })
      return ok({
        nextState: { ...state, currentTrick: null, passedSeats: [], currentSeat: state.leadSeat },
        events,
      })
    }
    const next = nextActiveSeat(seat, passedSeats, turns)!
    return ok({ nextState: { ...state, passedSeats, currentSeat: next }, events })
  }

  const { combination } = valid.value
  const played = new Set<CardCode>(combination.cards)
  const seats: SeatState[] = state.seats.map((s, i) =>
    i === seat ? { hand: s.hand.filter((c) => !played.has(c)), hasPlayed: true } : s,
  )
  const events: GameEvent[] = [{ type: 'PLAYED', seat, combination }]

  // Rule: If someone declared Báo Xâm (`samSeat`) and another player (`seat !== samSeat`) beats their play,
  // the match ends immediately — the blocker (`seat`) wins and `samSeat` is penalized (Đền Xâm).
  if (state.samSeat !== null && state.samSeat !== undefined && seat !== state.samSeat) {
    const winnerSeat = seat
    const foulSeat = state.samSeat
    const endReason: MatchEndReason = 'SAM_CAUGHT'
    events.push({ type: 'MATCH_FINISHED', winnerSeat, endReason, foulSeat })
    return ok({
      nextState: {
        ...state,
        seats,
        currentTrick: combination,
        leadSeat: seat,
        status: 'FINISHED',
        winnerSeat,
        foulSeat,
        endReason,
      },
      events,
    })
  }

  const emptySeat = seats.findIndex((s) => s.hand.length === 0)
  if (emptySeat !== -1) {
    // Rule (Thối 2 cuối): In v2+, if the last combination played to empty the hand is a 2 (single/pair/triple/quad 2),
    // that player is penalized as losing (bị xử thua vì thối 2 cuối), and the opponent wins.
    const isLastCardTwo = ruleset.version >= 2 && combination.type !== 'STRAIGHT' && combination.keyRank === TWO_RANK_VALUE
    if (isLastCardTwo) {
      const winnerSeat =
        state.currentTrick !== null && state.leadSeat !== seat
          ? state.leadSeat
          : (nextActiveSeat(seat, state.passedSeats, turns) ?? seatAfter(seat, turns))
      const foulSeat = seat
      const endReason: MatchEndReason = 'THOI_2_CUOI'
      events.push({ type: 'MATCH_FINISHED', winnerSeat, endReason, foulSeat })
      return ok({
        nextState: {
          ...state,
          seats,
          currentTrick: combination,
          leadSeat: seat,
          status: 'FINISHED',
          winnerSeat,
          foulSeat,
          endReason,
        },
        events,
      })
    }

    const winnerSeat = emptySeat
    const endReason: MatchEndReason = state.samSeat === winnerSeat ? 'SAM_SUCCESS' : 'NORMAL'
    events.push(
      endReason === 'NORMAL'
        ? { type: 'MATCH_FINISHED', winnerSeat }
        : { type: 'MATCH_FINISHED', winnerSeat, endReason, foulSeat: null },
    )
    return ok({
      nextState: {
        ...state,
        seats,
        currentTrick: combination,
        leadSeat: seat,
        status: 'FINISHED',
        winnerSeat,
        foulSeat: null,
        endReason,
      },
      events,
    })
  }

  const next = nextActiveSeat(seat, state.passedSeats, turns)
  if (next === null) {
    // Everyone else already passed: the player who just played leads a fresh round.
    events.push({ type: 'ROUND_RESET', leadSeat: seat })
    return ok({
      nextState: { ...state, seats, leadSeat: seat, currentTrick: null, passedSeats: [], currentSeat: seat },
      events,
    })
  }
  return ok({ nextState: { ...state, seats, leadSeat: seat, currentTrick: combination, currentSeat: next }, events })
}

/**
 * The move the server makes when a turn times out [R27]: PASS, or, for a leader who can't pass,
 * their lowest single card.
 */
export function timeoutAction(state: MatchState, ruleset: GameRuleSet): GameAction | null {
  if (state.status !== 'PLAYING') return null
  const seat = state.currentSeat
  if (state.currentTrick !== null || ruleset.leaderCanPass) return { type: 'PASS', seat }
  const lowest = sortCards(parseCards(state.seats[seat]!.hand))[0]
  return lowest ? { type: 'PLAY', seat, cards: [lowest.code] } : null
}
