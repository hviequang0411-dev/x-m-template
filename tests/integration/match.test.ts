import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canBeat, classify, parseCards, sortCards, XAM_BASELINE_V1 as R, type Combination } from '@engine'
import {
  adminClient,
  call,
  errorCode,
  fullRoom,
  myHand,
  newPlayers,
  okBody,
  type Player,
  type PublicState,
} from './helpers'

type Started = { matchId: string; version: number; state: PublicState }

async function startedMatch() {
  const room = await fullRoom()
  const started = okBody(await call<Started>(room.players[0]!, 'start-match', { roomId: room.roomId }))
  return { ...room, matchId: started.matchId, state: started.state }
}

/** The cheapest legal play: smallest combination, lowest key. null when only PASS is possible. */
function cheapestPlay(hand: string[], trick: Combination | null): string[] | null {
  const cards = sortCards(parseCards(hand))
  let best: Combination | null = null
  for (let mask = 1; mask < 1 << cards.length; mask++) {
    const combo = classify(cards.filter((_, i) => mask & (1 << i)), R)
    if (!combo || (trick && !canBeat(combo, trick, R))) continue
    if (!best || combo.size < best.size || (combo.size === best.size && combo.keyRank < best.keyRank)) best = combo
  }
  return best ? [...best.cards] : null
}

const bySeat = (players: Player[], seat: number) => players[seat]!

describe('start-match (T5.3)', () => {
  it('only the host can start; each player sees only their own 10 cards', async () => {
    const room = await fullRoom()
    const notHost = await call(room.players[2]!, 'start-match', { roomId: room.roomId })
    expect([notHost.status, errorCode(notHost)]).toEqual([403, 'NOT_ROOM_HOST'])

    const { state, matchId } = okBody(await call<Started>(room.players[0]!, 'start-match', { roomId: room.roomId }))
    expect(state).toMatchObject({ status: 'PLAYING', version: 1, currentTrick: null, passedSeats: [] })
    expect(state.seats.map((s) => s.cardCount)).toEqual([10, 10, 10, 10])
    expect(state.currentSeat).toBe(state.leadSeat)
    expect(JSON.stringify(state)).not.toMatch(/hand/i)

    const hands: string[][] = []
    for (const p of room.players) {
      const { data } = await p.client.from('player_private_states').select('user_id, hand').eq('match_id', matchId)
      expect(data).toHaveLength(1) // RLS: own row only
      expect(data![0]!.user_id).toBe(p.userId)
      hands.push(data![0]!.hand as string[])
    }
    expect(new Set(hands.flat()).size).toBe(40)

    // The DEAL log entry carries no cards.
    const { data: actions } = await room.players[1]!.client.from('game_actions').select('action_type, cards').eq('match_id', matchId)
    expect(actions).toEqual([{ action_type: 'DEAL', cards: null }])

    const again = await call(room.players[0]!, 'start-match', { roomId: room.roomId })
    expect(errorCode(again)).toBe('MATCH_IN_PROGRESS')
  })

  it('needs at least 2 players; 3 can play, with seats 0..2 and 10 cards each [R01b]', async () => {
    const [host, a, b] = await newPlayers(3)
    const { roomId, code } = okBody(await call<{ roomId: string; code: string }>(host!, 'create-room', {}))
    const alone = await call(host!, 'start-match', { roomId })
    expect([alone.status, errorCode(alone)]).toEqual([409, 'NOT_ENOUGH_PLAYERS'])
    expect(alone.body).toMatchObject({ error: { message: 'Cần ít nhất 2 người chơi để bắt đầu' } })
    okBody(await call(a!, 'join-room', { code }))
    okBody(await call(b!, 'join-room', { code }))
    const { state, matchId } = okBody(await call<Started>(host!, 'start-match', { roomId }))
    expect(state.seats.map((s) => [s.seat, s.cardCount])).toEqual([[0, 10], [1, 10], [2, 10]])
    expect(await myHand(b!, matchId)).toHaveLength(10)
  })

  it('leaving mid-match is refused', async () => {
    const { roomId, players } = await startedMatch()
    expect(errorCode(await call(players[1]!, 'leave-room', { roomId }))).toBe('MATCH_IN_PROGRESS')
  })
})

describe('play-cards / pass-turn (T5.4)', () => {
  it('enforces turn, version and idempotency', async () => {
    const { matchId, state, players } = await startedMatch()
    const leader = bySeat(players, state.currentSeat)
    const other = bySeat(players, (state.currentSeat + 1) % 4)
    const hand = await myHand(leader, matchId)
    const card = sortCards(parseCards(hand))[0]!.code

    const notTurn = await call(other, 'play-cards', {
      actionId: randomUUID(), matchId, expectedVersion: 1, cards: [(await myHand(other, matchId))[0]],
    })
    expect(errorCode(notTurn)).toBe('NOT_YOUR_TURN')

    const leaderPass = await call(leader, 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: 1 })
    expect(errorCode(leaderPass)).toBe('LEADER_CANNOT_PASS')

    const notOwned = await call(leader, 'play-cards', {
      actionId: randomUUID(), matchId, expectedVersion: 1, cards: [(await myHand(other, matchId))[0]],
    })
    expect(errorCode(notOwned)).toBe('CARD_NOT_OWNED')

    const stale = await call(leader, 'play-cards', { actionId: randomUUID(), matchId, expectedVersion: 0, cards: [card] })
    expect([stale.status, errorCode(stale)]).toEqual([409, 'VERSION_CONFLICT'])

    const actionId = randomUUID()
    const first = okBody(await call<{ version: number; state: PublicState }>(leader, 'play-cards', {
      actionId, matchId, expectedVersion: 1, cards: [card],
    }))
    expect(first.version).toBe(2)
    expect(first.state.currentTrick).toMatchObject({ type: 'SINGLE', cards: [card] })
    expect(await myHand(leader, matchId)).not.toContain(card)

    // Same actionId again (a client retry): same result, nothing new committed.
    const retry = okBody(await call<{ version: number; duplicate?: boolean }>(leader, 'play-cards', {
      actionId, matchId, expectedVersion: 1, cards: [card],
    }))
    expect(retry).toMatchObject({ version: 2, duplicate: true })
    const { count } = await adminClient()
      .from('game_actions')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', matchId)
    expect(count).toBe(2) // DEAL + one PLAY
  })

  it('plays a full match to a winner; the next match is led by that winner [R14, R15]', async () => {
    const { roomId, matchId, players } = await startedMatch()
    let state = (await adminClient().rpc('match_public_state', { p_match: matchId })).data as PublicState
    let moves = 0
    while (state.status === 'PLAYING') {
      if (++moves > 200) throw new Error('match did not finish')
      const p = bySeat(players, state.currentSeat)
      const play = cheapestPlay(await myHand(p, matchId), state.currentTrick as Combination | null)
      const r = play
        ? await call<{ state: PublicState }>(p, 'play-cards', { actionId: randomUUID(), matchId, expectedVersion: state.version, cards: play })
        : await call<{ state: PublicState }>(p, 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: state.version })
      state = okBody(r).state
    }

    expect(state.status).toBe('FINISHED')
    expect(state.seats[state.winnerSeat!]!.cardCount).toBe(0)
    const admin = adminClient()
    const { data: room } = await admin.from('game_rooms').select('status, last_winner_seat').eq('id', roomId).single()
    expect(room).toEqual({ status: 'WAITING', last_winner_seat: state.winnerSeat })
    const { data: mp } = await admin.from('match_players').select('seat, status').eq('match_id', matchId).order('seat')
    expect(mp!.map((x) => x.status)).toEqual([0, 1, 2, 3].map((s) => (s === state.winnerSeat ? 'WON' : 'LOST')))

    const late = await call(bySeat(players, 0), 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: state.version })
    expect(errorCode(late)).toBe('MATCH_NOT_ACTIVE')

    // Losers paid out; anyone left under 10 points blocks the next ranked match [R34].
    const { data: balances } = await admin.from('profiles').select('total_score').in('id', players.map((p) => p.userId))
    if (balances!.some((b) => b.total_score < 10)) {
      const blocked = await call(players[0]!, 'start-match', { roomId })
      expect([blocked.status, errorCode(blocked)]).toEqual([409, 'NOT_ENOUGH_POINTS'])
      await admin.from('profiles').update({ total_score: 10 }).in('id', players.map((p) => p.userId)).lt('total_score', 10)
    }
    const next = okBody(await call<Started>(players[0]!, 'start-match', { roomId }))
    expect(next.state.currentSeat).toBe(state.winnerSeat)
  })

  it('an authenticated user cannot call apply_game_action directly', async () => {
    const { matchId, players } = await startedMatch()
    const { error } = await players[0]!.client.rpc('apply_game_action', {
      p_match: matchId, p_action_id: randomUUID(), p_user: players[0]!.userId, p_expected_version: 1,
      p_action_type: 'PASS', p_cards: null, p_next: {},
    })
    expect(error?.code).toBe('42501')
  })
})
