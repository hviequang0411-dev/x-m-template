import { describe, expect, it } from 'vitest'
import { createDeck, deal, shuffle, shuffleAndDeal } from './deck.ts'
import { cryptoRandomInt, seededRandomInt } from './rng.ts'
import { XAM_BASELINE_V1 } from './ruleset.ts'

const codes = (cards: { code: string }[]) => cards.map((c) => c.code)

describe('createDeck', () => {
  it('builds 52 unique cards, 4 of each rank', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(codes(deck)).size).toBe(52)
    const perValue = new Map<number, number>()
    for (const c of deck) perValue.set(c.value, (perValue.get(c.value) ?? 0) + 1)
    expect([...perValue.values()].every((n) => n === 4)).toBe(true)
    expect(perValue.size).toBe(13)
  })
})

describe('shuffle', () => {
  it('is a permutation and does not mutate the input', () => {
    const deck = createDeck()
    const before = codes(deck)
    const out = shuffle(deck, seededRandomInt(42))
    expect(codes(deck)).toEqual(before)
    expect([...codes(out)].sort()).toEqual([...before].sort())
    expect(codes(out)).not.toEqual(before)
  })

  it('is deterministic for a seed and differs across seeds', () => {
    const a = codes(shuffle(createDeck(), seededRandomInt(7)))
    const b = codes(shuffle(createDeck(), seededRandomInt(7)))
    const c = codes(shuffle(createDeck(), seededRandomInt(8)))
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('works with the crypto RNG', () => {
    const out = shuffle(createDeck(), cryptoRandomInt)
    expect(new Set(codes(out)).size).toBe(52)
  })

  it('rejects an RNG that returns out-of-range values', () => {
    expect(() => shuffle([1, 2, 3], () => 5)).toThrow(RangeError)
    expect(() => shuffle([1, 2, 3], () => 0.5)).toThrow(RangeError)
  })

  it('is roughly uniform: each card lands in position 0 about 1/52 of the time', () => {
    const rng = seededRandomInt(123)
    const counts = new Map<string, number>()
    const runs = 20_000
    for (let i = 0; i < runs; i++) {
      const top = shuffle(createDeck(), rng)[0]!.code
      counts.set(top, (counts.get(top) ?? 0) + 1)
    }
    const expected = runs / 52
    expect(counts.size).toBe(52)
    for (const n of counts.values()) expect(Math.abs(n - expected)).toBeLessThan(expected * 0.35)
  })
})

describe('deal', () => {
  it('gives handSize × 4 cards with no overlap and 12 undealt [R01]', () => {
    const { hands, undealt } = shuffleAndDeal(XAM_BASELINE_V1, seededRandomInt(1))
    expect(hands).toHaveLength(4)
    for (const h of hands) expect(h).toHaveLength(10)
    expect(undealt).toHaveLength(12)
    const all = [...hands.flat(), ...undealt]
    expect(new Set(codes(all)).size).toBe(52)
  })

  it('deals round-robin from the top of the deck', () => {
    const deck = createDeck()
    const { hands } = deal(deck, { players: 4, handSize: 2 })
    expect(codes(hands[0]!)).toEqual([deck[0]!.code, deck[4]!.code])
    expect(codes(hands[3]!)).toEqual([deck[3]!.code, deck[7]!.code])
  })

  it('rejects short or duplicated decks', () => {
    const deck = createDeck()
    expect(() => deal(deck.slice(0, 39), XAM_BASELINE_V1)).toThrow(RangeError)
    expect(() => deal([...deck.slice(0, 51), deck[0]!], XAM_BASELINE_V1)).toThrow(RangeError)
  })
})

describe('rng', () => {
  it('seeded RNG stays in range', () => {
    const rng = seededRandomInt(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('rejects invalid ranges', () => {
    expect(() => seededRandomInt(1)(0)).toThrow(RangeError)
    expect(() => cryptoRandomInt(1.5)).toThrow(RangeError)
  })
})
