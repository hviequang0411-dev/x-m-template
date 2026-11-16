/**
 * Card encoding shared by the engine, the database (text[] columns) and the UI.
 * Code = rank char + suit char, e.g. "3S", "TH" (T = 10), "2D".
 * Suits never affect rules [R03]; they only matter for display and identity.
 */

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A', '2'] as const
export const SUITS = ['S', 'C', 'D', 'H'] as const

export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]
export type CardCode = `${Rank}${Suit}`

export interface Card {
  readonly code: CardCode
  readonly rank: Rank
  readonly suit: Suit
  /** 3..15, low to high: 3 … K=13, A=14, 2=15 [R02]. */
  readonly value: number
}

const RANK_VALUE: Readonly<Record<Rank, number>> = Object.freeze(
  Object.fromEntries(RANKS.map((r, i) => [r, i + 3])) as Record<Rank, number>,
)

const CARD_CODE_RE = /^[3-9TJQKA2][SCDH]$/

export function isCardCode(value: unknown): value is CardCode {
  return typeof value === 'string' && CARD_CODE_RE.test(value)
}

export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank]
}

export class InvalidCardError extends Error {
  readonly input: unknown
  constructor(input: unknown) {
    super(`INVALID_CARD: ${JSON.stringify(input)}`)
    this.name = 'InvalidCardError'
    this.input = input
  }
}

export function parseCard(code: unknown): Card {
  if (!isCardCode(code)) throw new InvalidCardError(code)
  const rank = code[0] as Rank
  const suit = code[1] as Suit
  return { code, rank, suit, value: RANK_VALUE[rank] }
}

export function formatCard(card: Pick<Card, 'rank' | 'suit'>): CardCode {
  const code = `${card.rank}${card.suit}`
  if (!isCardCode(code)) throw new InvalidCardError(card)
  return code
}

/** Parses a list and rejects duplicates (a hand or a play never repeats a card). */
export function parseCards(codes: readonly unknown[]): Card[] {
  const cards = codes.map(parseCard)
  if (new Set(cards.map((c) => c.code)).size !== cards.length) throw new InvalidCardError(codes)
  return cards
}

const SUIT_ORDER: Readonly<Record<Suit, number>> = { S: 0, C: 1, D: 2, H: 3 }

/** Display order only: by rank, then a fixed suit order so the sort is total and stable. */
export function compareCardsForDisplay(a: Card, b: Card): number {
  return a.value - b.value || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]
}

export function sortCards<T extends Card>(cards: readonly T[]): T[] {
  return [...cards].sort(compareCardsForDisplay)
}
