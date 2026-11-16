import { describe, expect, it } from 'vitest'
import { seededRandomInt } from './rng.ts'
import { XAM_BASELINE_V1 as R } from './ruleset.ts'
import { chooseFirstLeader, nextActiveSeat, roundIsOver, seatAfter } from './turn.ts'

describe('TurnManager', () => {
  it('goes counter-clockwise: 0 → 3 → 2 → 1 → 0 [R12]', () => {
    expect([0, 3, 2, 1].map((s) => seatAfter(s, R))).toEqual([3, 2, 1, 0])
  })

  it('skips locked seats', () => {
    expect(nextActiveSeat(0, [], R)).toBe(3)
    expect(nextActiveSeat(0, [3], R)).toBe(2)
    expect(nextActiveSeat(0, [3, 2], R)).toBe(1)
    expect(nextActiveSeat(2, [1], R)).toBe(0)
  })

  it('returns null when every other seat is locked', () => {
    expect(nextActiveSeat(0, [1, 2, 3], R)).toBeNull()
  })

  it('detects the end of a round: 3 passes reset to the leader [R11]', () => {
    expect(roundIsOver(2, [3, 1], R)).toBe(false)
    expect(roundIsOver(2, [3, 1, 0], R)).toBe(true)
    expect(roundIsOver(2, [0, 1, 3], R)).toBe(true)
  })

  it('first leader is random, later the previous winner [R13, R14]', () => {
    const seen = new Set<number>()
    const rng = seededRandomInt(5)
    for (let i = 0; i < 200; i++) seen.add(chooseFirstLeader(R, rng))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
    expect(chooseFirstLeader(R, () => 0, 2)).toBe(2)
    expect(chooseFirstLeader(R, () => 3, 0)).toBe(0)
  })
})
