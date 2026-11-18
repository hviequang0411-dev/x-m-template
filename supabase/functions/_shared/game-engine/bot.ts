import { parseCards, sortCards, type Card } from './cards.ts'
import { canBeat, classify, type Combination } from './combination.ts'
import type { GameRuleSet } from './ruleset.ts'
import type { GameAction, MatchState } from './state.ts'

const TWO = 15

/** Every legal combination the seat could play now (all subsets of a hand of ≤ 13 cards). */
export function legalCombinations(state: MatchState, seat: number, ruleset: GameRuleSet): Combination[] {
  const hand = sortCards(parseCards(state.seats[seat]!.hand))
  const out: Combination[] = []
  for (let mask = 1; mask < 1 << hand.length; mask++) {
    const picked: Card[] = []
    for (let i = 0; i < hand.length; i++) if (mask & (1 << i)) picked.push(hand[i]!)
    const combo = classify(picked, ruleset)
    if (combo && (!state.currentTrick || canBeat(combo, state.currentTrick, ruleset))) out.push(combo)
  }
  return out
}

/** Uses a 2 or a four of a kind: worth keeping for later. */
function isPrecious(c: Combination): boolean {
  return c.type === 'FOUR_OF_A_KIND' || parseCards([...c.cards]).some((card) => card.value === TWO)
}

const lowest = (c: Combination) => Math.min(...parseCards([...c.cards]).map((card) => card.value))

/**
 * A simple, deterministic bot (R36: bot matches are unranked). Always returns a legal action:
 * - goes out whenever one non-2 combination empties its hand;
 * - avoids leaving only 2s as its final card (which would trigger Thối 2 cuối);
 * - leading: sheds its lowest card together with as many cards as possible (its set or straight),
 *   keeping 2s and four of a kinds back unless nothing else is left or needed to avoid Thối 2;
 * - following: beats with the cheapest combination, but holds back 2s / four of a kind while it has
 *   more than 4 cards, unless an opponent is about to go out (≤ 2 cards) or declared Báo Xâm; otherwise passes.
 */
export function chooseBotMove(state: MatchState, ruleset: GameRuleSet): GameAction {
  const seat = state.currentSeat
  const handCards = parseCards(state.seats[seat]!.hand)
  const handSize = handCards.length
  const combos = legalCombinations(state, seat, ruleset)
  const play = (c: Combination): GameAction => ({ type: 'PLAY', seat, cards: [...c.cards] })
  const blockingSam = state.samSeat !== null && state.samSeat !== undefined && state.samSeat !== seat
  const isTwoFinish = (c: Combination) =>
    !blockingSam && ruleset.version >= 2 && c.size === handSize && c.type !== 'STRAIGHT' && c.keyRank === TWO

  const leavesOnlyTwos = (c: Combination) => {
    if (ruleset.version < 2) return false
    const used = new Set(c.cards)
    const rem = handCards.filter((card) => !used.has(card.code))
    return rem.length > 0 && rem.every((card) => card.value === TWO)
  }

  // If blocking Báo Xâm, any valid beat wins immediately!
  if (blockingSam && combos[0]) return play(combos[0])

  const finishing = combos.find((c) => c.size === handSize && !isTwoFinish(c))
  if (finishing) return play(finishing)

  if (state.currentTrick === null) {
    // Leading: a pass is not allowed, and the hand is non-empty, so there is always a single.
    const safe = combos.filter((c) => !isTwoFinish(c) && !leavesOnlyTwos(c))
    const pool = safe.length > 0 ? safe : combos
    const ordered = [...pool].sort((a, b) => lowest(a) - lowest(b) || b.size - a.size || a.keyRank - b.keyRank)
    return play(ordered.find((c) => !isPrecious(c)) ?? ordered[0]!)
  }

  const opponentNearlyOut = state.seats.some((s, i) => i !== seat && s.hand.length <= 2)
  const affordable = combos
    .filter((c) => !isTwoFinish(c) && !leavesOnlyTwos(c))
    .filter((c) => !isPrecious(c) || handSize <= 4 || opponentNearlyOut)
    .sort((a, b) => a.keyRank - b.keyRank || Number(isPrecious(a)) - Number(isPrecious(b)))
  return affordable[0] ? play(affordable[0]) : { type: 'PASS', seat }
}
