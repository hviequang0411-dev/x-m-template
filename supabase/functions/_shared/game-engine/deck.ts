import { RANKS, SUITS, parseCard, type Card, type CardCode } from './cards.ts'
import type { RandomInt } from './rng.ts'

/** The part of a GameRuleSet the dealer needs (number, so tests can deal small hands). */
export interface DealConfig {
  readonly players: number
  readonly handSize: number
}

/** DeckFactory: the 52 unique cards in a fixed, canonical order. */
export function createDeck(): Card[] {
  return RANKS.flatMap((rank) => SUITS.map((suit) => parseCard(`${rank}${suit}` as CardCode)))
}

/** DeckShuffler: Fisher–Yates with an injected RNG. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], randomInt: RandomInt): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError(`RNG returned ${j} for range [0, ${i}]`)
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

export interface Deal {
  /** One hand per seat, index = seat number. */
  readonly hands: Card[][]
  /** Cards not dealt (12 with the baseline ruleset). Never shown to players [R01]. */
  readonly undealt: Card[]
}

/** CardDealer: deals `handSize` cards to each of `players` seats, one at a time, round-robin. */
export function deal(deck: readonly Card[], ruleset: DealConfig): Deal {
  const { players, handSize } = ruleset
  const needed = players * handSize
  if (deck.length < needed) throw new RangeError(`Deck has ${deck.length} cards, need ${needed}`)
  if (new Set(deck.map((c) => c.code)).size !== deck.length) throw new RangeError('Deck has duplicate cards')
  const hands: Card[][] = Array.from({ length: players }, () => [])
  for (let i = 0; i < needed; i++) hands[i % players]!.push(deck[i]!)
  return { hands, undealt: deck.slice(needed) }
}

/** What start-match runs: fresh deck → shuffle → deal. */
export function shuffleAndDeal(ruleset: DealConfig, randomInt: RandomInt): Deal {
  return deal(shuffle(createDeck(), randomInt), ruleset)
}
