import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseCards, sortCards } from '@engine'
import { adminClient, call, errorCode, fullRoom, myHand, okBody, type PublicState } from './helpers'

describe('concurrency (T5.4)', () => {
  it('20 parallel play-cards requests on the same version → exactly 1 commit', async () => {
    const { roomId, players } = await fullRoom()
    const { matchId, state } = okBody(
      await call<{ matchId: string; state: PublicState }>(players[0]!, 'start-match', { roomId }),
    )
    const leader = players[state.currentSeat]!
    const card = sortCards(parseCards(await myHand(leader, matchId)))[0]!.code

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        call(leader, 'play-cards', { actionId: randomUUID(), matchId, expectedVersion: 1, cards: [card] }),
      ),
    )
    const ok = results.filter((r) => r.body.ok)
    const codes = results.filter((r) => !r.body.ok).map(errorCode)
    expect(results.filter((r) => errorCode(r)?.startsWith('NON_ENVELOPE')).map((r) => r.body)).toEqual([])
    expect(ok).toHaveLength(1)
    // Losers fail the early check, the row-locked check, or the stale-snapshot re-check:
    // always VERSION_CONFLICT, never a misleading rule error.
    expect(codes).toEqual(Array(19).fill('VERSION_CONFLICT'))

    const { data: actions } = await adminClient()
      .from('game_actions')
      .select('action_type, version_after')
      .eq('match_id', matchId)
      .order('version_after')
    expect(actions).toEqual([
      { action_type: 'DEAL', version_after: 1 },
      { action_type: 'PLAY', version_after: 2 },
    ])
    const { data: m } = await adminClient().from('matches').select('version').eq('id', matchId).single()
    expect(m?.version).toBe(2)
    expect(await myHand(leader, matchId)).toHaveLength(9)
  })

  it('20 parallel apply_game_action RPC calls (bypassing the function) → exactly 1 commit', async () => {
    const { roomId, players } = await fullRoom()
    const { matchId, state } = okBody(
      await call<{ matchId: string; state: PublicState }>(players[0]!, 'start-match', { roomId }),
    )
    const leader = players[state.currentSeat]!
    const card = sortCards(parseCards(await myHand(leader, matchId)))[0]!
    const admin = adminClient()
    const next = {
      status: 'PLAYING',
      currentSeat: (state.currentSeat + 3) % 4,
      leadSeat: state.currentSeat,
      currentTrick: { type: 'SINGLE', size: 1, keyRank: card.value, cards: [card.code] },
      passedSeats: [],
      winnerSeat: null,
      combination: 'SINGLE',
    }
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        admin.rpc('apply_game_action', {
          p_match: matchId,
          p_action_id: randomUUID(),
          p_user: leader.userId,
          p_expected_version: 1,
          p_action_type: 'PLAY',
          p_cards: [card.code],
          p_next: next,
        }),
      ),
    )
    expect(results.filter((r) => !r.error)).toHaveLength(1)
    expect(results.filter((r) => r.error).every((r) => r.error!.message === 'VERSION_CONFLICT')).toBe(true)
  })

  it('the same actionId sent 10 times in parallel commits once; the other 9 get an idempotent replay', async () => {
    const { roomId, players } = await fullRoom()
    const { matchId, state } = okBody(
      await call<{ matchId: string; state: PublicState }>(players[0]!, 'start-match', { roomId }),
    )
    const leader = players[state.currentSeat]!
    const card = sortCards(parseCards(await myHand(leader, matchId)))[0]!.code
    const actionId = randomUUID()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call(leader, 'play-cards', { actionId, matchId, expectedVersion: 1, cards: [card] })),
    )
    // Every request is either the commit or an idempotent replay of it.
    const statuses = results.map((r) => (r.body.ok ? ((r.body as { duplicate?: boolean }).duplicate ? 'dup' : 'ok') : errorCode(r)))
    const odd = results.filter((r) => !r.body.ok && errorCode(r)!.startsWith('NON_ENVELOPE'))
    expect(odd.map((r) => (r.body as { error: { message: string } }).error.message)).toEqual([])
    expect(statuses.filter((s) => s === 'ok')).toHaveLength(1)
    expect(statuses.filter((s) => s !== 'ok')).toEqual(Array(9).fill('dup'))
    const { count } = await adminClient()
      .from('game_actions')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', matchId)
      .eq('action_id', actionId)
    expect(count).toBe(1)
  })
})
