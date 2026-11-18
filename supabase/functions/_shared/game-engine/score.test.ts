import { describe, expect, it } from 'vitest'
import type { CardCode } from './cards.ts'
import { XAM_BASELINE_V1 as R } from './ruleset.ts'
import { calculateScores } from './score.ts'
import type { MatchState } from './state.ts'

const seat = (hand: string, hasPlayed = true) => ({
  hand: (hand ? hand.split(' ') : []) as CardCode[],
  hasPlayed,
})
const finished = (seats: ReturnType<typeof seat>[], winnerSeat: number): Pick<MatchState, 'status' | 'seats' | 'winnerSeat'> => ({
  status: 'FINISHED',
  seats,
  winnerSeat,
})

describe('calculateScores', () => {
  it('each loser pays 1 point per card left; the winner gets the sum [R17]', () => {
    const r = calculateScores(finished([seat(''), seat('3S 4S'), seat('5S'), seat('6S 7S 8S')], 0), R)
    expect(r.map((x) => x.scoreDelta)).toEqual([6, -2, -1, -3])
    expect(r.map((x) => x.remainingCards)).toEqual([0, 2, 1, 3])
    expect(r[0]).toMatchObject({ isWinner: true, remainingHand: [], penalties: {} })
  })

  it('a loser who never played pays a flat 15 instead (cóng) [R18]', () => {
    const r = calculateScores(finished([seat('3S 4S', true), seat(''), seat('5S 6S 7S 8S 9S TS JS QS KS AS', false), seat('3H', true)], 1), R)
    expect(r.map((x) => x.scoreDelta)).toEqual([-2, 18, -15, -1])
    expect(r[2]!.penalties).toEqual({ cong: true })
    expect(r[2]!.remainingCards).toBe(10)
  })

  it('cóng applies even with fewer cards (never played means never played)', () => {
    const r = calculateScores(finished([seat(''), seat('3S', false), seat('4S'), seat('5S')], 0), R)
    expect(r[1]!.scoreDelta).toBe(-15)
  })

  it('records thối 2 and thối tứ quý without scoring them in v1 [R19, R20]', () => {
    const r = calculateScores(finished([seat('2S 2H 9S 9H 9D 9C'), seat(''), seat('3S'), seat('4S')], 1), R)
    expect(r[0]).toMatchObject({ scoreDelta: -6, penalties: { thoi2: 2, thoiTuQuy: ['9'] } })
    expect(r[1]!.scoreDelta).toBe(8)
  })

  it('returns the remaining hand sorted for display', () => {
    const r = calculateScores(finished([seat('2D AS 3H'), seat(''), seat('3S'), seat('4S')], 1), R)
    expect(r[0]!.remainingHand).toEqual(['3H', 'AS', '2D'])
  })

  it('always sums to zero', () => {
    const r = calculateScores(finished([seat('3S 4S 5S', false), seat('6S'), seat(''), seat('7S 8S', false)], 2), R)
    expect(r.reduce((s, x) => s + x.scoreDelta, 0)).toBe(0)
  })

  it('refuses an unfinished match or a winner holding cards', () => {
    const s = [seat(''), seat('3S'), seat('4S'), seat('5S')]
    expect(() => calculateScores({ status: 'PLAYING', seats: s, winnerSeat: null }, R)).toThrow('MATCH_NOT_FINISHED')
    expect(() => calculateScores(finished(s, 1), R)).toThrow('WINNER_HAS_CARDS')
  })

  it('scores Thối 2 cuối and Báo Xâm (SAM_CAUGHT / SAM_SUCCESS)', () => {
    const thoi2Res = calculateScores(
      {
        status: 'FINISHED',
        seats: [seat(''), seat('4S 5S')],
        winnerSeat: 1,
        foulSeat: 0,
        endReason: 'THOI_2_CUOI',
      },
      R,
    )
    expect(thoi2Res.map((x) => x.scoreDelta)).toEqual([-15, 15])
    expect(thoi2Res[0]!.penalties).toEqual({ thoi2: 1, thoi2Cuoi: true })

    const samCaughtRes = calculateScores(
      {
        status: 'FINISHED',
        seats: [seat('6S'), seat('AC'), seat('3D 4D')],
        winnerSeat: 1,
        foulSeat: 0,
        endReason: 'SAM_CAUGHT',
      },
      R,
    )
    expect(samCaughtRes.map((x) => x.scoreDelta)).toEqual([-40, 40, 0])
    expect(samCaughtRes[0]!.penalties).toEqual({ denSam: true })
  })
})
