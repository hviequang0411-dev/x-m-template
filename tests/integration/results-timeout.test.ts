import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canBeat, classify, parseCards, sortCards, XAM_BASELINE_V1 as R, type Combination } from '@engine'
import { adminClient, call, errorCode, fullRoom, myHand, okBody, type PublicState } from './helpers'

type Started = { matchId: string; version: number; state: PublicState }

async function startedMatch() {
  const room = await fullRoom()
  const started = okBody(await call<Started>(room.players[0]!, 'start-match', { roomId: room.roomId }))
  return { ...room, matchId: started.matchId, state: started.state }
}

const stateOf = async (matchId: string) =>
  (await adminClient().rpc('match_public_state', { p_match: matchId })).data as PublicState

/** Test-only: move the turn deadline into the past so a timeout can be claimed now. */
async function expireTurn(matchId: string) {
  const { error } = await adminClient()
    .from('matches')
    .update({ turn_deadline: new Date(Date.now() - 1000).toISOString() })
    .eq('id', matchId)
  if (error) throw error
}

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

describe('scores persisted at match end (T6.1)', () => {
  it('writes match_results once, matching the hands, and updates profiles', async () => {
    const { matchId, players } = await startedMatch()
    const admin = adminClient()
    const before = await admin.from('profiles').select('id, total_score, matches_played, matches_won').in('id', players.map((p) => p.userId))

    // Only the leader plays (lowest single each round); everyone else always passes, so the three
    // losers never play a card and all pay the cóng penalty.
    let state = await stateOf(matchId)
    const leaderSeat = state.currentSeat
    while (state.status === 'PLAYING') {
      const p = players[state.currentSeat]!
      const r = state.currentTrick === null
        ? await call<{ state: PublicState }>(p, 'play-cards', {
            actionId: randomUUID(), matchId, expectedVersion: state.version, cards: cheapestPlay(await myHand(p, matchId), null)!.slice(0, 1),
          })
        : await call<{ state: PublicState }>(p, 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: state.version })
      state = okBody(r).state
    }
    expect(state.winnerSeat).toBe(leaderSeat)

    const { data: results } = await players[1]!.client
      .from('match_results')
      .select('seat, user_id, is_winner, remaining_cards, remaining_hand, score_delta, penalties')
      .eq('match_id', matchId)
      .order('seat')
    expect(results).toHaveLength(4) // readable by any seated player (RLS)
    for (const r of results!) {
      // Each loser owes cóng 15 but starts with 10 points, so pays 10 [R35]; the winner gets 30.
      if (r.seat === leaderSeat) expect(r).toMatchObject({ is_winner: true, remaining_cards: 0, score_delta: 30, penalties: {} })
      else expect(r).toMatchObject({ is_winner: false, remaining_cards: 10, score_delta: -10, penalties: { cong: true, owed: 15 } })
    }
    expect(results!.reduce((s, r) => s + r.score_delta, 0)).toBe(0)

    const after = await admin.from('profiles').select('id, total_score, matches_played, matches_won').in('id', players.map((p) => p.userId))
    for (const p of players) {
      const b = before.data!.find((x) => x.id === p.userId)!
      const a = after.data!.find((x) => x.id === p.userId)!
      const r = results!.find((x) => x.user_id === p.userId)!
      expect(a.total_score - b.total_score).toBe(r.score_delta)
      expect(a.matches_played - b.matches_played).toBe(1)
      expect(a.matches_won - b.matches_won).toBe(r.is_winner ? 1 : 0)
    }

    // Persisted once: a late action can't write anything more.
    const late = await call(players[0]!, 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: state.version })
    expect(errorCode(late)).toBe('MATCH_NOT_ACTIVE')
    const { count } = await admin.from('match_results').select('id', { count: 'exact', head: true }).eq('match_id', matchId)
    expect(count).toBe(4)
  })

  it('players cannot write results or their own score', async () => {
    const { players } = await startedMatch()
    const p = players[0]!
    const { error: insertError } = await p.client.from('match_results').insert({
      match_id: randomUUID(), user_id: p.userId, seat: 0, is_winner: true, remaining_cards: 0, score_delta: 999,
    })
    expect(insertError?.code).toBe('42501')
    const { error: scoreError } = await p.client.from('profiles').update({ total_score: 999 }).eq('id', p.userId)
    expect(scoreError?.code).toBe('42501')
  })
})

describe('claim-timeout (T6.3, R27)', () => {
  it('an early claim is refused; after the deadline any player can make the leader auto-play their lowest single', async () => {
    const { matchId, state, players } = await startedMatch()
    const claimer = players[(state.currentSeat + 1) % 4]!
    const early = await call(claimer, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 1 })
    expect([early.status, errorCode(early)]).toEqual([409, 'TURN_NOT_EXPIRED'])

    const leader = players[state.currentSeat]!
    const lowest = sortCards(parseCards(await myHand(leader, matchId)))[0]!.code
    await expireTurn(matchId)
    const r = okBody(await call<{ state: PublicState }>(claimer, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 1 }))
    expect(r.state.currentTrick).toMatchObject({ type: 'SINGLE', cards: [lowest] })
    expect(await myHand(leader, matchId)).not.toContain(lowest)

    const { data: action } = await adminClient()
      .from('game_actions')
      .select('action_type, user_id, seat, cards')
      .eq('match_id', matchId)
      .eq('version_after', 2)
      .single()
    expect(action).toEqual({ action_type: 'TIMEOUT_PLAY', user_id: leader.userId, seat: state.currentSeat, cards: [lowest] })
  })

  it('a non-leader auto-passes; the new deadline must expire again before the next claim', async () => {
    const { matchId, state, players } = await startedMatch()
    const leader = players[state.currentSeat]!
    const card = sortCards(parseCards(await myHand(leader, matchId)))[0]!.code
    okBody(await call(leader, 'play-cards', { actionId: randomUUID(), matchId, expectedVersion: 1, cards: [card] }))

    const nextSeat = (state.currentSeat + 3) % 4 // CCW
    expect(errorCode(await call(leader, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 2 }))).toBe('TURN_NOT_EXPIRED')
    await expireTurn(matchId)
    const r = okBody(await call<{ state: PublicState }>(leader, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 2 }))
    expect(r.state.passedSeats).toEqual([nextSeat])
    expect(errorCode(await call(leader, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 3 }))).toBe('TURN_NOT_EXPIRED')
  })

  it('parallel claims of the same expired turn commit once', async () => {
    const { matchId, players } = await startedMatch()
    await expireTurn(matchId)
    const results = await Promise.all(
      players.flatMap((p) => [0, 1, 2].map(() => call(p, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 1 }))),
    )
    const codes = results.map((r) => (r.body.ok ? 'ok' : `${errorCode(r)} ${r.status} ${(r.body as { error: { message: string } }).error.message.slice(0, 80)}`))
    expect(codes.filter((c) => c === 'ok')).toHaveLength(1)
    // Losers either saw the old version (VERSION_CONFLICT) or the fresh deadline (TURN_NOT_EXPIRED).
    expect(codes.filter((c) => c !== 'ok' && !/^(VERSION_CONFLICT|TURN_NOT_EXPIRED) /.test(c))).toEqual([])
    expect((await stateOf(matchId)).version).toBe(2)
  })
})

describe('finish-match abort (T6.3, R30)', () => {
  it('only the host, only after 5 minutes without a move; aborting writes no results', async () => {
    const { roomId, matchId, players } = await startedMatch()
    const notHost = await call(players[1]!, 'finish-match', { matchId })
    expect([notHost.status, errorCode(notHost)]).toEqual([403, 'NOT_ROOM_HOST'])
    const tooSoon = await call(players[0]!, 'finish-match', { matchId })
    expect([tooSoon.status, errorCode(tooSoon)]).toEqual([409, 'MATCH_NOT_STALLED'])

    // Test-only: pretend the last move was 6 minutes ago.
    await adminClient().from('game_actions').update({ created_at: new Date(Date.now() - 6 * 60_000).toISOString() }).eq('match_id', matchId)
    const r = okBody(await call<{ state: PublicState }>(players[0]!, 'finish-match', { matchId }))
    expect(r.state).toMatchObject({ status: 'ABORTED', winnerSeat: null, version: 2 })

    const admin = adminClient()
    const { data: room } = await admin.from('game_rooms').select('status').eq('id', roomId).single()
    expect(room?.status).toBe('WAITING')
    const { count } = await admin.from('match_results').select('id', { count: 'exact', head: true }).eq('match_id', matchId)
    expect(count).toBe(0)
    expect(errorCode(await call(players[0]!, 'finish-match', { matchId }))).toBe('MATCH_NOT_ACTIVE')
    expect(errorCode(await call(players[0]!, 'claim-timeout', { actionId: randomUUID(), matchId, expectedVersion: 2 }))).toBe('MATCH_NOT_ACTIVE')
  })
})
