import type { CardCode } from './cards.ts'
import type { Combination } from './combination.ts'

export type MatchEndReason = 'NORMAL' | 'THOI_2_CUOI' | 'SAM_SUCCESS' | 'SAM_CAUGHT'

/** Full authoritative match state. Contains every hand: server-side only, never sent as-is. */
export interface MatchState {
  readonly status: 'PLAYING' | 'FINISHED'
  /** Index = seat number (0..3). */
  readonly seats: readonly SeatState[]
  /** Whose turn it is. Meaningless once FINISHED. */
  readonly currentSeat: number
  /** Who owns the round: the last seat to play, or the seat leading a fresh round. */
  readonly leadSeat: number
  /** The combination to beat, or null on a fresh round (the leader plays anything). */
  readonly currentTrick: Combination | null
  /** Seats locked out until the round resets [R10]. */
  readonly passedSeats: readonly number[]
  readonly winnerSeat: number | null
  /** Seat that declared Báo Xâm at the start of the match, if any. */
  readonly samSeat?: number | null
  /** Seat that lost due to a foul (playing a 2 as last card or getting Báo Xâm blocked), if any. */
  readonly foulSeat?: number | null
  /** How the match ended. */
  readonly endReason?: MatchEndReason | null
}

export interface SeatState {
  readonly hand: readonly CardCode[]
  /** False until the seat plays its first card (cóng check, R18). */
  readonly hasPlayed: boolean
}

export type GameAction =
  | { readonly type: 'PLAY'; readonly seat: number; readonly cards: readonly CardCode[] }
  | { readonly type: 'PASS'; readonly seat: number }
  | { readonly type: 'DECLARE_SAM'; readonly seat: number }

export type GameEvent =
  | { readonly type: 'PLAYED'; readonly seat: number; readonly combination: Combination }
  | { readonly type: 'PASSED'; readonly seat: number }
  | { readonly type: 'SAM_DECLARED'; readonly seat: number }
  | { readonly type: 'ROUND_RESET'; readonly leadSeat: number }
  | { readonly type: 'MATCH_FINISHED'; readonly winnerSeat: number; readonly endReason?: MatchEndReason; readonly foulSeat?: number | null }

/**
 * Engine error codes. Shared with the Edge Functions' error envelope (ARCHITECTURE §8).
 * The Vietnamese messages live in the frontend (`src/features/game/errors.ts`).
 */
export const MOVE_ERROR_CODES = [
  'INVALID_REQUEST', // malformed action: unknown seat, empty card list, bad or duplicate card codes
  'MATCH_NOT_ACTIVE',
  'NOT_YOUR_TURN',
  'CARD_NOT_OWNED',
  'INVALID_COMBINATION',
  'CANNOT_BEAT_CURRENT_PLAY',
  'LEADER_CANNOT_PASS', // RULE_DECISIONS C6, R16
] as const
export type MoveErrorCode = (typeof MOVE_ERROR_CODES)[number]

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

/** What every seat may see: card counts instead of hands. Safe to broadcast. */
export interface PublicMatchState {
  readonly status: MatchState['status']
  readonly currentSeat: number
  readonly leadSeat: number
  readonly currentTrick: Combination | null
  readonly passedSeats: readonly number[]
  readonly winnerSeat: number | null
  readonly samSeat?: number | null
  readonly foulSeat?: number | null
  readonly endReason?: MatchEndReason | null
  readonly seats: readonly { readonly cardCount: number; readonly hasPlayed: boolean }[]
}

export function toPublicState(state: MatchState): PublicMatchState {
  return {
    status: state.status,
    currentSeat: state.currentSeat,
    leadSeat: state.leadSeat,
    currentTrick: state.currentTrick,
    passedSeats: [...state.passedSeats],
    winnerSeat: state.winnerSeat,
    ...(state.samSeat !== undefined ? { samSeat: state.samSeat } : {}),
    ...(state.foulSeat !== undefined ? { foulSeat: state.foulSeat } : {}),
    ...(state.endReason !== undefined ? { endReason: state.endReason } : {}),
    seats: state.seats.map((s) => ({ cardCount: s.hand.length, hasPlayed: s.hasPlayed })),
  }
}
