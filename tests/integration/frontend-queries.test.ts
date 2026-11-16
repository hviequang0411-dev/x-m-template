import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseCards, sortCards } from '@engine'
import {
  ACTIVE_ROOM_SELECT,
  HAND_SELECT,
  HISTORY_SELECT,
  MATCH_SELECT,
  PROFILE_SELECT,
  RESULTS_SELECT,
  ROOM_SELECT,
} from '@/features/queries'
import { adminClient, call, fullRoom, myHand, newPlayer, okBody, type PublicState } from './helpers'

/**
 * Runs every select string the frontend uses, exactly as written, as a real player through RLS.
 * Component tests mock the API layer, so this is what catches PostgREST errors such as an
 * ambiguous embed (300 Multiple Choices) or a column the player may not read.
 */
describe('frontend queries against the real database', () => {
  it('every select works for a player, and returns nothing for an outsider', async () => {
    const { roomId, players } = await fullRoom()
    const { matchId } = okBody(await call<{ matchId: string }>(players[0]!, 'start-match', { roomId }))

    // Finish the match quickly: the leader plays its lowest card, everyone else passes.
    let state = (await adminClient().rpc('match_public_state', { p_match: matchId })).data as PublicState
    while (state.status === 'PLAYING') {
      const p = players[state.currentSeat]!
      const r = state.currentTrick === null
        ? await call<{ state: PublicState }>(p, 'play-cards', {
            actionId: randomUUID(), matchId, expectedVersion: state.version,
            cards: [sortCards(parseCards(await myHand(p, matchId)))[0]!.code],
          })
        : await call<{ state: PublicState }>(p, 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: state.version })
      state = okBody(r).state
    }

    const me = players[1]!
    const db = me.client
    const queries = {
      activeRoom: await db.from('room_players').select(ACTIVE_ROOM_SELECT).eq('user_id', me.userId).eq('status', 'ACTIVE').maybeSingle(),
      room: await db.from('game_rooms').select(ROOM_SELECT).eq('id', roomId).maybeSingle(),
      match: await db.from('matches').select(MATCH_SELECT).eq('id', matchId).maybeSingle(),
      hand: await db.from('player_private_states').select(HAND_SELECT).eq('match_id', matchId).maybeSingle(),
      results: await db.from('match_results').select(RESULTS_SELECT).eq('match_id', matchId).order('seat'),
      history: await db.from('match_results').select(HISTORY_SELECT).eq('user_id', me.userId).order('created_at', { ascending: false }),
      profile: await db.from('profiles').select(PROFILE_SELECT).eq('id', me.userId).maybeSingle(),
    }
    for (const [name, r] of Object.entries(queries)) expect({ name, status: r.status, error: r.error }).toEqual({ name, status: 200, error: null })

    expect(queries.activeRoom.data).toMatchObject({ seat: 1, room: { id: roomId, status: 'WAITING' } })
    expect((queries.room.data as unknown as { players: unknown[] }).players).toHaveLength(4)
    expect(queries.match.data).toMatchObject({ id: matchId, status: 'FINISHED', room: { host_id: players[0]!.userId } })
    expect((queries.match.data as unknown as { players: { profile: { display_name: string } }[] }).players[0]!.profile.display_name).toBeTruthy()
    expect(queries.results.data).toHaveLength(4)
    expect(queries.history.data![0]).toMatchObject({ match_id: matchId, match: { room: { code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/) } } })
    expect(queries.profile.data).toMatchObject({ id: me.userId, matches_played: 1 })

    const outsider = await newPlayer()
    const o = outsider.client
    expect((await o.from('matches').select(MATCH_SELECT).eq('id', matchId).maybeSingle()).data).toBeNull()
    expect((await o.from('match_results').select(RESULTS_SELECT).eq('match_id', matchId)).data).toEqual([])
    expect((await o.from('game_rooms').select(ROOM_SELECT).eq('id', roomId).maybeSingle()).data).toBeNull()
  })
})
