import { describe, expect, it } from 'vitest'
import { parseCards, type Card } from './cards.ts'
import { canBeat, classify, type Combination } from './combination.ts'
import { createDeck, shuffle } from './deck.ts'
import { seededRandomInt } from './rng.ts'
import { XAM_BASELINE_V1 as R } from './ruleset.ts'

const c = (s: string) => classify(parseCards(s.split(' ')), R)
const must = (s: string): Combination => {
  const combo = c(s)
  if (!combo) throw new Error(`expected a combination: ${s}`)
  return combo
}

describe('classify: valid combinations', () => {
  it.each([
    // cards, type, size, keyRank
    ['3S', 'SINGLE', 1, 3],
    ['2H', 'SINGLE', 1, 15],
    ['AD', 'SINGLE', 1, 14],
    ['7S 7H', 'PAIR', 2, 7],
    ['2S 2D', 'PAIR', 2, 15],
    ['KS KC KD', 'TRIPLE', 3, 13],
    ['9S 9C 9D 9H', 'FOUR_OF_A_KIND', 4, 9],
    ['2S 2C 2D 2H', 'FOUR_OF_A_KIND', 4, 15],
    // straights, suits mixed [R04]
    ['3S 4H 5D', 'STRAIGHT', 3, 5],
    ['5D 3S 4H', 'STRAIGHT', 3, 5],
    ['9S TH JD QC KS', 'STRAIGHT', 5, 13],
    // A and 2 placement [R05]
    ['AS 2H 3D', 'STRAIGHT', 3, 3], // lowest 3-card straight
    ['2H 3D 4C', 'STRAIGHT', 3, 4],
    ['AS 2H 3D 4C 5S', 'STRAIGHT', 5, 5],
    ['QS KH AD', 'STRAIGHT', 3, 14], // highest 3-card straight
    ['TS JH QD KC AS', 'STRAIGHT', 5, 14],
    // length limits: 10 is allowed [R04]
    ['AS 2H 3D 4C 5S 6H 7D 8C 9S TH', 'STRAIGHT', 10, 10],
    ['5S 6H 7D 8C 9S TH JD QC KS AH', 'STRAIGHT', 10, 14],
  ])('%s → %s', (cards, type, size, keyRank) => {
    expect(c(cards)).toMatchObject({ type, size, keyRank })
  })

  it('returns cards in display order, low straights as A-2-3…', () => {
    expect(must('5D 3S 4H').cards).toEqual(['3S', '4H', '5D'])
    expect(must('3D 2H AS').cards).toEqual(['AS', '2H', '3D'])
    expect(must('AS KH QD').cards).toEqual(['QD', 'KH', 'AS'])
  })
})

describe('classify: invalid sets', () => {
  it.each([
    ['KS AH 2D', 'K-A-2 wraparound'],
    ['QS KH AD 2C', 'Q-K-A-2 wraparound'],
    ['KS AH 2D 3C', 'K-A-2-3 wraparound'],
    ['3S 4H', 'two-card run'],
    ['3S 5H 6D', 'gap'],
    ['AS 3H 4D', 'A low without 2'],
    ['3S 3H 4D 5C', 'duplicate rank in a run'],
    ['3S 3H 4D 4C 5S 5H', 'consecutive pairs (no đôi thông in v1) [R07]'],
    ['7S 7H 7D 8C', 'triple plus one'],
    ['3S 4S', 'mixed pair'],
    ['3S 4H 5D 6C 7S 8H 9D TC JS QH KD', '11-card straight (max 10)'],
    ['AS 2H 3D 4C 5S 6H 7D 8C 9S TH JD', '11-card low straight'],
  ])('%s is not a combination (%s)', (cards) => {
    expect(c(cards)).toBeNull()
  })

  it('rejects empty and duplicate-card sets', () => {
    expect(classify([], R)).toBeNull()
    const [three] = parseCards(['3S'])
    expect(classify([three!, three!], R)).toBeNull()
  })
})

describe('canBeat', () => {
  it.each([
    // next, current, expected
    ['4S', '3H', true],
    ['3H', '3S', false], // equal rank never beats, suits ignored [R03]
    ['3S', '4H', false],
    ['2D', 'AS', true],
    ['8S 8H', '7C 7D', true],
    ['8S 8H', '8C 8D', false],
    ['KS KC KD', 'QS QC QD', true],
    ['4S 5H 6D', '3S 4H 5D', true],
    ['3S 4H 5D', 'AS 2H 3D', true], // A-2-3 is the lowest
    ['2H 3D 4C', 'AS 2H 3D', true],
    ['QS KH AD', 'JS QH KD', true], // Q-K-A is the highest
    ['AS 2H 3D', 'QS KH AD', false],
    ['4S 5H 6D', '4C 5D 6H', false], // same top card
    // different size or type never beats [R06, R08]
    ['4S 5H 6D 7C', '3S 4H 5D', false],
    ['3S 4H 5D', '4S 5H 6D 7C', false],
    ['9S 9H', '8S', false],
    ['9S 9H 9D', '3S 3H', false],
    ['3S 4H 5D', '9S 9H 9D', false],
    // four of a kind [R09]
    ['3S 3C 3D 3H', '2S', true], // beats a single 2
    ['3S 3C 3D 3H', 'AS', false], // only a 2
    ['3S 3C 3D 3H', '2S 2H', false], // not a pair of 2s
    ['3S 3C 3D 3H', '2S 2H 2D', false],
    ['4S 4C 4D 4H', '3S 3C 3D 3H', true], // higher four beats lower
    ['3S 3C 3D 3H', '4S 4C 4D 4H', false],
    ['2S', '3S 3C 3D 3H', false], // a 2 doesn't beat four of a kind
    ['AS 2H 3D 4C', '9S 9C 9D 9H', false],
  ])('%s on %s → %s', (next, current, expected) => {
    expect(canBeat(must(next), must(current), R)).toBe(expected)
  })
})

describe('properties over random hands', () => {
  // All combinations that can be formed from random small subsets of a shuffled deck.
  function randomCombinations(seed: number, count: number): Combination[] {
    const rng = seededRandomInt(seed)
    const deck = createDeck()
    const out: Combination[] = []
    let attempts = 0
    while (out.length < count && attempts < count * 200) {
      attempts++
      const size = 1 + rng(6)
      const pick: Card[] = shuffle(deck, rng).slice(0, size)
      const combo = classify(pick, R)
      if (combo) out.push(combo)
    }
    return out
  }

  // Also seed every possible straight and set so rare types are well represented.
  function allStraightsAndSets(): Combination[] {
    const out: Combination[] = []
    const lowOrder = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
    const suits = ['S', 'H', 'D', 'C']
    for (let len = 3; len <= 10; len++)
      for (let start = 0; start + len <= lowOrder.length; start++) {
        const ranks = lowOrder.slice(start, start + len)
        const combo = classify(parseCards(ranks.map((r, i) => `${r}${suits[i % 4]}`)), R)
        if (combo) out.push(combo)
      }
    for (const r of ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'])
      for (let n = 1; n <= 4; n++) out.push(must(suits.slice(0, n).map((s) => `${r}${s}`).join(' ')))
    return out
  }

  const pool = [...randomCombinations(2026, 400), ...allStraightsAndSets()]

  it('generates every combination type', () => {
    expect(new Set(pool.map((p) => p.type))).toEqual(
      new Set(['SINGLE', 'PAIR', 'TRIPLE', 'STRAIGHT', 'FOUR_OF_A_KIND']),
    )
  })

  it('every straight is classified exactly once per (length, top card)', () => {
    const straights = allStraightsAndSets().filter((s) => s.type === 'STRAIGHT')
    // Runs of 3..10 over the 14 positions A(low),2,3,…,K,A(high): Σ(15 − len) = 68, all valid.
    expect(straights).toHaveLength(68)
    const keys = straights.map((s) => `${s.size}:${s.keyRank}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('canBeat is irreflexive', () => {
    for (const a of pool) expect(canBeat(a, a, R)).toBe(false)
  })

  it('canBeat is asymmetric', () => {
    for (const a of pool) for (const b of pool) if (canBeat(a, b, R)) expect(canBeat(b, a, R)).toBe(false)
  })

  it('never crosses types or sizes, except four of a kind on a single 2 [R09]', () => {
    for (const a of pool)
      for (const b of pool) {
        if (!canBeat(a, b, R)) continue
        const bomb = a.type === 'FOUR_OF_A_KIND' && b.type === 'SINGLE' && b.keyRank === 15
        if (!bomb) {
          expect(a.type).toBe(b.type)
          expect(a.size).toBe(b.size)
        }
      }
  })

  // Not transitive across the R09 exception (four 3s > a 2 > an A, yet four 3s don't beat an A),
  // so check within each type+size group.
  it('is transitive within a type and size', { timeout: 60_000 }, () => {
    const groups = new Map<string, Combination[]>()
    for (const p of pool) groups.set(`${p.type}:${p.size}`, [...(groups.get(`${p.type}:${p.size}`) ?? []), p])
    let violations = 0
    for (const g of groups.values())
      for (const a of g)
        for (const b of g)
          if (canBeat(a, b, R)) for (const x of g) if (canBeat(b, x, R) && !canBeat(a, x, R)) violations++
    expect(violations).toBe(0)
  })

  it('documents the R09 non-transitivity', () => {
    expect(canBeat(must('3S 3C 3D 3H'), must('2S'), R)).toBe(true)
    expect(canBeat(must('2S'), must('AS'), R)).toBe(true)
    expect(canBeat(must('3S 3C 3D 3H'), must('AS'), R)).toBe(false)
  })

  it('classify ignores card order and suits', () => {
    const rng = seededRandomInt(7)
    for (const combo of pool) {
      const shuffled = shuffle(parseCards([...combo.cards]), rng)
      expect(classify(shuffled, R)).toEqual(combo)
    }
  })
})
