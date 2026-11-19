import { describe, expect, it } from 'vitest'
import { parseCards, type CardCode } from './cards.ts'
import { chooseBotMove } from './bot.ts'
import { classify } from './combination.ts'
import { shuffleAndDeal } from './deck.ts'
import { applyAction, createMatchState } from './gameState.ts'
import { validateMove } from './moveValidator.ts'
import { seededRandomInt } from './rng.ts'
import { XAM_BASELINE_V2 as R } from './ruleset.ts'
import type { MatchState } from './state.ts'

const hands = (...hs: string[]) => hs.map((h) => h.split(' ') as CardCode[])
const withTrick = (state: MatchState, cards: string, leadSeat: number): MatchState => ({
  ...state,
  leadSeat,
  currentTrick: classify(parseCards(cards.split(' ')), R),
})

describe('chooseBotMove', () => {
  it('leads its lowest card together with its set', () => {
    const s = createMatchState(hands('3S 3H 7D 9C KS', '4S 5S', '6S 8S'), 0)
    expect(chooseBotMove(s, R)).toEqual({ type: 'PLAY', seat: 0, cards: ['3S', '3H'] })
  })

  it('leads a straight from its lowest card when that sheds more', () => {
    const s = createMatchState(hands('3S 4H 5D 9C KS', '4S 5S', '6S 8S'), 0)
    expect(chooseBotMove(s, R)).toEqual({ type: 'PLAY', seat: 0, cards: ['3S', '4H', '5D'] })
  })

  it('keeps a 2 back when leading if anything else is available', () => {
    const s = createMatchState(hands('2S 9C KS', '4S 5S', '6S 8S'), 0)
    expect(chooseBotMove(s, R)).toEqual({ type: 'PLAY', seat: 0, cards: ['9C'] })
  })

  it('goes out whenever one play empties its hand', () => {
    const s = withTrick({ ...createMatchState(hands('4S 4H', 'QS QH', '6S 8S'), 0), currentSeat: 0 }, '3S 3H', 1)
    expect(chooseBotMove(s, R)).toEqual({ type: 'PLAY', seat: 0, cards: ['4S', '4H'] })
  })

  it('beats with the cheapest combination', () => {
    const s = withTrick(createMatchState(hands('5S 9C KS AH 3D 3C', '4S', '6S'), 0), '8D', 1)
    expect(chooseBotMove(s, R)).toEqual({ type: 'PLAY', seat: 0, cards: ['9C'] })
  })

  it('holds a 2 back early, but uses it when an opponent is about to go out', () => {
    const early = withTrick(createMatchState(hands('2S 4C 5D 6H 8S', 'QS QH JD', '6S 8C 9D'), 0), 'AD', 1)
    expect(chooseBotMove(early, R)).toEqual({ type: 'PASS', seat: 0 })
    const late = withTrick(createMatchState(hands('2S 4C 5D 6H 8S', 'QS', '6S 8C 9D'), 0), 'AD', 1)
    expect(chooseBotMove(late, R)).toEqual({ type: 'PLAY', seat: 0, cards: ['2S'] })
  })

  it('passes when it cannot beat', () => {
    const s = withTrick(createMatchState(hands('3C 4D', 'QS QH', '6S 8C'), 0), 'KD', 1)
    expect(chooseBotMove(s, R)).toEqual({ type: 'PASS', seat: 0 })
  })

  it('all-bot games with 2, 3, 4 and 5 seats always finish with only legal moves', { timeout: 60_000 }, () => {
    for (const players of [2, 3, 4, 5]) {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = seededRandomInt(seed * 10 + players)
        const deal = shuffleAndDeal({ players, handSize: R.handSize }, rng)
        let state = createMatchState(deal.hands.map((h) => h.map((c) => c.code)), rng(players))
        let steps = 0
        while (state.status === 'PLAYING') {
          if (++steps > 300) throw new Error(`no finish: ${players} players, seed ${seed}`)
          const move = chooseBotMove(state, R)
          expect(validateMove(state, move, R).ok).toBe(true)
          const r = applyAction(state, move, R)
          if (!r.ok) throw new Error(r.error)
          state = r.value.nextState
        }
        if (state.endReason === 'THOI_2_CUOI') {
          expect(state.seats[state.foulSeat!]!.hand).toHaveLength(0)
          expect(state.winnerSeat).not.toBe(state.foulSeat)
        } else {
          expect(state.seats[state.winnerSeat!]!.hand).toHaveLength(0)
        }
      }
    }
  })
})
