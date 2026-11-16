import { describe, expect, it } from 'vitest'
import { parseCards, type CardCode } from './cards.ts'
import { classify } from './combination.ts'
import { createMatchState } from './gameState.ts'
import { validateMove } from './moveValidator.ts'
import { XAM_BASELINE_V1 as R } from './ruleset.ts'
import { MOVE_ERROR_CODES, type GameAction, type MatchState, type MoveErrorCode } from './state.ts'

const hands: CardCode[][] = [
  ['3S', '4H', '5D', '9S', '9H'],
  ['6S', '7S', 'KD', 'KH', '2C'],
  ['8C', '8D', 'TC', 'JD', 'QH'],
  ['4S', '4C', '4D', '4H', 'AS'],
]
const fresh = createMatchState(hands, 0)
const withTrick = (cards: CardCode[], over: Partial<MatchState> = {}): MatchState => ({
  ...fresh,
  currentTrick: classify(parseCards(cards), R),
  ...over,
})
const code = (state: MatchState, action: GameAction) => {
  const r = validateMove(state, action, R)
  return r.ok ? 'OK' : r.error
}

describe('validateMove: one test per error code', () => {
  const cases: [MoveErrorCode, MatchState, GameAction][] = [
    ['INVALID_REQUEST', fresh, { type: 'PLAY', seat: 7, cards: ['3S'] }],
    ['MATCH_NOT_ACTIVE', { ...fresh, status: 'FINISHED', winnerSeat: 1 }, { type: 'PLAY', seat: 0, cards: ['3S'] }],
    ['NOT_YOUR_TURN', fresh, { type: 'PLAY', seat: 3, cards: ['AS'] }],
    ['CARD_NOT_OWNED', fresh, { type: 'PLAY', seat: 0, cards: ['2C'] }],
    ['INVALID_COMBINATION', fresh, { type: 'PLAY', seat: 0, cards: ['3S', '9S'] }],
    ['CANNOT_BEAT_CURRENT_PLAY', withTrick(['TD']), { type: 'PLAY', seat: 0, cards: ['9S'] }],
    ['LEADER_CANNOT_PASS', fresh, { type: 'PASS', seat: 0 }],
  ]

  it('covers every code', () => {
    expect(cases.map((c) => c[0]).sort()).toEqual([...MOVE_ERROR_CODES].sort())
  })

  it.each(cases)('%s', (expected, state, action) => {
    expect(code(state, action)).toBe(expected)
  })
})

describe('validateMove: details', () => {
  it.each([
    [{ type: 'PLAY', seat: 0, cards: [] }],
    [{ type: 'PLAY', seat: 0, cards: ['3S', '3S'] }],
    [{ type: 'PLAY', seat: 0, cards: ['ZZ'] }],
    [{ type: 'PLAY', seat: 0 }],
    [{ type: 'PLAY', seat: -1, cards: ['3S'] }],
    [{ type: 'PLAY', seat: 0.5, cards: ['3S'] }],
    [{ type: 'DRAW', seat: 0 }],
  ])('rejects malformed %j as INVALID_REQUEST', (action) => {
    expect(code(fresh, action as unknown as GameAction)).toBe('INVALID_REQUEST')
  })

  it('accepts any valid combination from the leader', () => {
    expect(code(fresh, { type: 'PLAY', seat: 0, cards: ['3S', '4H', '5D'] })).toBe('OK')
    expect(code(fresh, { type: 'PLAY', seat: 0, cards: ['9S', '9H'] })).toBe('OK')
  })

  it('returns the classified combination', () => {
    const r = validateMove(fresh, { type: 'PLAY', seat: 0, cards: ['9H', '9S'] }, R)
    expect(r).toEqual({ ok: true, value: { type: 'PLAY', combination: expect.objectContaining({ type: 'PAIR', keyRank: 9 }) } })
  })

  it('allows a PASS when there is a trick to beat', () => {
    expect(code(withTrick(['TD']), { type: 'PASS', seat: 0 })).toBe('OK')
  })

  it('checks the turn before anything about the cards', () => {
    expect(code(fresh, { type: 'PLAY', seat: 1, cards: ['ZZ' as CardCode] })).toBe('INVALID_REQUEST')
    expect(code(fresh, { type: 'PLAY', seat: 1, cards: ['3S'] })).toBe('NOT_YOUR_TURN')
    expect(code(fresh, { type: 'PASS', seat: 1 })).toBe('NOT_YOUR_TURN')
  })

  it('a different size or type cannot beat the trick [R06, R08]', () => {
    expect(code(withTrick(['3C', '3D']), { type: 'PLAY', seat: 0, cards: ['9S'] })).toBe('CANNOT_BEAT_CURRENT_PLAY')
  })

  it('four of a kind beats a single 2 [R09]', () => {
    const state = withTrick(['2D'], { currentSeat: 3 })
    expect(code(state, { type: 'PLAY', seat: 3, cards: ['4S', '4C', '4D', '4H'] })).toBe('OK')
  })
})
