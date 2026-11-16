import { describe, expect, it } from 'vitest'
import {
  RANKS,
  SUITS,
  formatCard,
  isCardCode,
  parseCard,
  parseCards,
  rankValue,
  sortCards,
  InvalidCardError,
} from './cards.ts'

const ALL_CODES = RANKS.flatMap((r) => SUITS.map((s) => `${r}${s}`))

describe('cards', () => {
  it('has 52 distinct codes', () => {
    expect(new Set(ALL_CODES).size).toBe(52)
  })

  it.each(ALL_CODES)('parse/format round-trips %s', (code) => {
    expect(formatCard(parseCard(code))).toBe(code)
  })

  it('maps rank values 3..15 with A=14 and 2=15 [R02]', () => {
    expect(RANKS.map(rankValue)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(parseCard('AS').value).toBe(14)
    expect(parseCard('2D').value).toBe(15)
    expect(parseCard('TH').value).toBe(10)
  })

  it.each([
    '', '10H', '1S', 'tH', '3s', 'XS', '3X', 'AS ', ' AS', 'ASS', 'S3', null, undefined, 3, {}, ['AS'],
  ])('rejects invalid code %j', (bad) => {
    expect(isCardCode(bad)).toBe(false)
    expect(() => parseCard(bad)).toThrow(InvalidCardError)
  })

  it('rejects a formatted card with a bad rank', () => {
    expect(() => formatCard({ rank: '1', suit: 'S' } as never)).toThrow(InvalidCardError)
  })

  it('parseCards rejects duplicates', () => {
    expect(parseCards(['3S', '4S']).map((c) => c.code)).toEqual(['3S', '4S'])
    expect(() => parseCards(['3S', '3S'])).toThrow(InvalidCardError)
  })

  it('sorts by rank (3 low, 2 high), then suit, without mutating input', () => {
    const input = parseCards(['2D', 'AS', '3H', 'TH', '3S', 'KC'])
    const before = input.map((c) => c.code)
    expect(sortCards(input).map((c) => c.code)).toEqual(['3S', '3H', 'TH', 'KC', 'AS', '2D'])
    expect(input.map((c) => c.code)).toEqual(before)
  })
})
