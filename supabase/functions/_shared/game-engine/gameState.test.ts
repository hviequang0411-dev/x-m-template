import { describe, expect, it } from 'vitest'
import { parseCards, type CardCode } from './cards.ts'
import { canBeat, classify, type Combination } from './combination.ts'
import { shuffleAndDeal } from './deck.ts'
import { applyAction, createMatchState, findWinner, timeoutAction, type Transition } from './gameState.ts'
import { seededRandomInt, type RandomInt } from './rng.ts'
import { XAM_BASELINE_V1 as R, XAM_BASELINE_V2 as R2 } from './ruleset.ts'
import { toPublicState, type GameAction, type MatchState } from './state.ts'

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x)
    Object.freeze(v)
  }
  return v
}

/** Applies an action that must succeed; the input is frozen so any mutation throws. */
function step(state: MatchState, action: GameAction): Transition {
  const r = applyAction(deepFreeze(state), action, R)
  if (!r.ok) throw new Error(`${JSON.stringify(action)} failed with ${r.error}`)
  return r.value
}
const play = (seat: number, cards: string) => ({ type: 'PLAY', seat, cards: cards.split(' ') as CardCode[] }) as const
const pass = (seat: number) => ({ type: 'PASS', seat }) as const

describe('createMatchState', () => {
  it('starts with the leader to play a fresh round', () => {
    const s = createMatchState([['3S'], ['4S'], ['5S'], ['6S']], 2)
    expect(s).toMatchObject({ status: 'PLAYING', currentSeat: 2, leadSeat: 2, currentTrick: null, passedSeats: [] })
    expect(s.seats.every((x) => !x.hasPlayed)).toBe(true)
  })

  it('rejects an out-of-range leader', () => {
    expect(() => createMatchState([['3S']], 1)).toThrow(RangeError)
  })
})

describe('scripted game', () => {
  //            seat 0              seat 1           seat 2               seat 3
  const hands = ['3S 4S 5S 2S 6S', '6H 7H KH KD', '9C TC JC QC 3C', '8D 8H 8C 8S AH'].map(
    (h) => h.split(' ') as CardCode[],
  )

  it('plays to completion with CCW turns, pass locks, resets and the R09 bomb', () => {
    let s = createMatchState(hands, 0)
    let t: Transition

    t = step(s, play(0, '3S 4S 5S')) // straight to 5
    s = t.nextState
    expect(s).toMatchObject({ currentSeat: 3, leadSeat: 0 })
    expect(s.currentTrick).toMatchObject({ type: 'STRAIGHT', keyRank: 5 })

    s = step(s, pass(3)).nextState
    expect(s).toMatchObject({ currentSeat: 2, passedSeats: [3] })

    s = step(s, play(2, '9C TC JC')).nextState // straight to J
    expect(s).toMatchObject({ currentSeat: 1, leadSeat: 2 })

    s = step(s, pass(1)).nextState
    expect(s.currentSeat).toBe(0) // seat 3 is locked, but 0 is next after 1 anyway

    t = step(s, pass(0)) // 3 passes → seat 2 leads a fresh round [R11]
    s = t.nextState
    expect(t.events).toEqual([{ type: 'PASSED', seat: 0 }, { type: 'ROUND_RESET', leadSeat: 2 }])
    expect(s).toMatchObject({ currentSeat: 2, leadSeat: 2, currentTrick: null, passedSeats: [] })

    expect(applyAction(s, pass(2), R)).toEqual({ ok: false, error: 'LEADER_CANNOT_PASS' }) // [R16]

    s = step(s, play(2, '3C')).nextState
    s = step(s, play(1, '6H')).nextState
    s = step(s, play(0, '2S')).nextState
    expect(s.currentSeat).toBe(3)
    s = step(s, play(3, '8D 8H 8C 8S')).nextState // four of a kind on a single 2 [R09]
    expect(s.currentTrick).toMatchObject({ type: 'FOUR_OF_A_KIND', keyRank: 8 })

    s = step(s, pass(2)).nextState
    s = step(s, pass(1)).nextState
    s = step(s, pass(0)).nextState
    expect(s).toMatchObject({ currentSeat: 3, currentTrick: null })

    t = step(s, play(3, 'AH')) // last card: seat 3 wins immediately [R15]
    s = t.nextState
    expect(t.events.at(-1)).toEqual({ type: 'MATCH_FINISHED', winnerSeat: 3 })
    expect(s).toMatchObject({ status: 'FINISHED', winnerSeat: 3 })
    expect(s.seats.map((x) => x.hand.length)).toEqual([1, 3, 1, 0])
    expect(s.seats.map((x) => x.hasPlayed)).toEqual([true, true, true, true])

    expect(applyAction(s, play(2, 'QC'), R)).toEqual({ ok: false, error: 'MATCH_NOT_ACTIVE' })
  })

  it('a locked seat stays locked until the reset, even when its turn would come round', () => {
    let s = createMatchState(hands, 0)
    s = step(s, play(0, '3S')).nextState
    s = step(s, pass(3)).nextState
    s = step(s, play(2, '9C')).nextState
    s = step(s, play(1, 'KH')).nextState
    expect(s.currentSeat).toBe(0)
    s = step(s, play(0, '2S')).nextState
    expect(s.currentSeat).toBe(2) // 3 is skipped
    expect(applyAction(s, play(3, 'AH'), R)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' })
  })

  it('tracks hasPlayed for cóng [R18]', () => {
    let s = createMatchState(hands, 0)
    s = step(s, play(0, '3S')).nextState
    s = step(s, pass(3)).nextState
    expect(s.seats[3]!.hasPlayed).toBe(false)
    expect(s.seats[0]!.hasPlayed).toBe(true)
  })

  it('resets on a play when every other seat has already passed (defensive path)', () => {
    const s: MatchState = { ...createMatchState(hands, 0), passedSeats: [1, 2, 3], leadSeat: 1 }
    const t = step(s, play(0, '3S'))
    expect(t.events.at(-1)).toEqual({ type: 'ROUND_RESET', leadSeat: 0 })
    expect(t.nextState).toMatchObject({ currentSeat: 0, leadSeat: 0, currentTrick: null, passedSeats: [] })
  })

  it('returns errors without touching the state', () => {
    const s = deepFreeze(createMatchState(hands, 0))
    expect(applyAction(s, play(1, '6H'), R)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' })
  })
})

describe('timeoutAction [R27]', () => {
  const hands = [['9S', '3H', 'KD'], ['4S', 'QS'], ['5S'], ['6S']] as CardCode[][]

  it('the leader auto-plays their lowest single', () => {
    expect(timeoutAction(createMatchState(hands, 0), R)).toEqual({ type: 'PLAY', seat: 0, cards: ['3H'] })
  })

  it('anyone else auto-passes', () => {
    let s = createMatchState(hands, 1)
    s = step(s, play(1, '4S')).nextState
    expect(timeoutAction(s, R)).toEqual({ type: 'PASS', seat: 0 })
  })

  it('does nothing once the match is over', () => {
    expect(timeoutAction({ ...createMatchState(hands, 0), status: 'FINISHED', winnerSeat: 1 }, R)).toBeNull()
  })
})

describe('toPublicState', () => {
  it('hides hands and exposes card counts only', () => {
    const s = createMatchState([['3S', '4S'], ['5S'], ['6S'], ['7S']], 0)
    const pub = toPublicState(s)
    expect(pub.seats).toEqual([
      { cardCount: 2, hasPlayed: false },
      { cardCount: 1, hasPlayed: false },
      { cardCount: 1, hasPlayed: false },
      { cardCount: 1, hasPlayed: false },
    ])
    expect(JSON.stringify(pub)).not.toMatch(/"3S"|"5S"|hand/)
  })
})

describe('random full games', () => {
  /** Every legal play for the current seat (all subsets of a ≤10-card hand). */
  function legalPlays(state: MatchState): Combination[] {
    const hand = parseCards(state.seats[state.currentSeat]!.hand)
    const out: Combination[] = []
    for (let mask = 1; mask < 1 << hand.length; mask++) {
      const combo = classify(hand.filter((_, i) => mask & (1 << i)), R)
      if (combo && (!state.currentTrick || canBeat(combo, state.currentTrick, R))) out.push(combo)
    }
    return out
  }

  function botAction(state: MatchState, rng: RandomInt): GameAction {
    const plays = legalPlays(state)
    const mayPass = state.currentTrick !== null
    if (plays.length === 0 || (mayPass && rng(3) === 0)) return { type: 'PASS', seat: state.currentSeat }
    return { type: 'PLAY', seat: state.currentSeat, cards: plays[rng(plays.length)]!.cards }
  }

  it('150 seeded games all finish with consistent state, never mutating input', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rng = seededRandomInt(seed)
      const deal = shuffleAndDeal(R, rng)
      const dealt = new Set(deal.hands.flat().map((c) => c.code))
      let s = createMatchState(
        deal.hands.map((h) => h.map((c) => c.code)),
        rng(4),
      )
      const playedCards: CardCode[] = []
      let steps = 0
      while (s.status === 'PLAYING') {
        if (++steps > 500) throw new Error(`seed ${seed}: game did not finish`)
        const action = botAction(s, rng)
        const before = JSON.stringify(s)
        const t = step(s, action)
        expect(JSON.stringify(s)).toBe(before)
        if (action.type === 'PLAY') playedCards.push(...action.cards)
        s = t.nextState

        // invariants
        const inHands = s.seats.flatMap((x) => x.hand)
        expect(new Set([...inHands, ...playedCards]).size).toBe(40)
        expect([...inHands, ...playedCards].every((c) => dealt.has(c))).toBe(true)
        expect(s.passedSeats).not.toContain(s.leadSeat)
        if (s.status === 'PLAYING') expect(s.passedSeats).not.toContain(s.currentSeat)
      }
      expect(findWinner(s)).toBe(s.winnerSeat)
      expect(s.seats[s.winnerSeat!]!.hand).toHaveLength(0)
      expect(s.seats.filter((x) => x.hand.length === 0)).toHaveLength(1)
    }
  })
})

describe('Báo Xâm & Thối 2 cuối (v2 rules)', () => {
  it('penalizes a player who plays a 2 as their final card (Thối 2 cuối)', () => {
    const s0 = createMatchState([['2S'], ['4H', '5H']], 0)
    const r = applyAction(s0, play(0, '2S'), R2)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.nextState).toMatchObject({
      status: 'FINISHED',
      winnerSeat: 1,
      foulSeat: 0,
      endReason: 'THOI_2_CUOI',
    })
  })

  it('allows declaring Báo Xâm before any card is played, gives declarer the lead, and ends immediately if blocked', () => {
    let s = createMatchState([['3S', '4S'], ['7H', '8H'], ['9D', 'AD']], 0)
    // Seat 2 declares Báo Xâm even though seat 0 was the initial leader
    const decl = applyAction(s, { type: 'DECLARE_SAM', seat: 2 }, R2)
    expect(decl.ok).toBe(true)
    if (!decl.ok) return
    s = decl.value.nextState
    expect(s).toMatchObject({ samSeat: 2, currentSeat: 2, leadSeat: 2 })

    // Seat 2 leads 9D; CCW next is seat 1
    const lead = applyAction(s, play(2, '9D'), R2)
    expect(lead.ok).toBe(true)
    if (!lead.ok) return
    s = lead.value.nextState
    expect(s.currentSeat).toBe(1)

    // Seat 1 passes; next is seat 0; let's have seat 1 beat instead in a 2-seat scenario
    const s2 = createMatchState([['5S', '6S'], ['KC', 'AC']], 0)
    const d2 = applyAction(s2, { type: 'DECLARE_SAM', seat: 0 }, R2)
    if (!d2.ok) throw new Error('expected ok')
    const p1 = applyAction(d2.value.nextState, play(0, '5S'), R2)
    if (!p1.ok) throw new Error('expected ok')
    // Seat 1 blocks seat 0's Báo Xâm with KC → seat 1 wins immediately!
    const block = applyAction(p1.value.nextState, play(1, 'KC'), R2)
    expect(block.ok).toBe(true)
    if (!block.ok) return
    expect(block.value.nextState).toMatchObject({
      status: 'FINISHED',
      winnerSeat: 1,
      foulSeat: 0,
      endReason: 'SAM_CAUGHT',
    })
  })
})
