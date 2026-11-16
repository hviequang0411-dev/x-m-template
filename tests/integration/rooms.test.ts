import { describe, expect, it } from 'vitest'
import { adminClient, call, errorCode, fullRoom, newPlayer, newPlayers, okBody } from './helpers'

describe('create-room / join-room / leave-room (T5.2)', () => {
  it('4 users join one room in seats 0..3; a 5th waits without a seat; rejoining gets ALREADY_IN_ROOM', async () => {
    const { roomId, code, players } = await fullRoom()
    const { data: seats } = await adminClient()
      .from('room_players')
      .select('user_id, seat')
      .eq('room_id', roomId)
      .eq('status', 'ACTIVE')
      .order('seat')
    expect(seats?.map((s) => s.user_id)).toEqual(players.map((p) => p.userId))
    expect(seats?.map((s) => s.seat)).toEqual([0, 1, 2, 3])

    const fifth = await call(await newPlayer(), 'join-room', { code })
    expect(fifth.body).toMatchObject({ ok: true, role: 'WAITING', seat: null })

    const again = await call(players[2]!, 'join-room', { code })
    expect([again.status, errorCode(again)]).toEqual([409, 'ALREADY_IN_ROOM'])
    const second = await call(players[0]!, 'create-room', {})
    expect(errorCode(second)).toBe('ALREADY_IN_ROOM')
  })

  it('codes are case-insensitive; unknown and malformed codes are rejected', async () => {
    const [host, guest, other] = await newPlayers(3)
    const created = okBody(await call<{ code: string }>(host!, 'create-room', {}))
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
    okBody(await call(guest!, 'join-room', { code: created.code.toLowerCase() }))

    const unknown = await call(other!, 'join-room', { code: created.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ' })
    expect([unknown.status, errorCode(unknown)]).toEqual([404, 'ROOM_NOT_FOUND'])
    const bad = await call(other!, 'join-room', { code: 'abc' })
    expect([bad.status, errorCode(bad)]).toEqual([400, 'INVALID_REQUEST'])
  })

  it('leave-room hands the host to the lowest seat and closes an empty room [R33]', async () => {
    const [host, a, b] = await newPlayers(3)
    const { roomId, code } = okBody(await call<{ roomId: string; code: string }>(host!, 'create-room', {}))
    okBody(await call(a!, 'join-room', { code }))
    okBody(await call(b!, 'join-room', { code }))

    okBody(await call(host!, 'leave-room', { roomId }))
    const { data: room } = await adminClient().from('game_rooms').select('host_id, status').eq('id', roomId).single()
    expect(room).toEqual({ host_id: a!.userId, status: 'WAITING' })

    // The freed seat 0 is taken by the next joiner.
    const c = await newPlayer()
    expect(okBody(await call<{ seat: number }>(c, 'join-room', { code })).seat).toBe(0)

    const notMember = await call(host!, 'leave-room', { roomId })
    expect(errorCode(notMember)).toBe('NOT_ROOM_MEMBER')

    for (const p of [a!, b!, c]) okBody(await call(p, 'leave-room', { roomId }))
    const { data: closed } = await adminClient().from('game_rooms').select('status').eq('id', roomId).single()
    expect(closed?.status).toBe('CLOSED')
    expect(errorCode(await call(c, 'join-room', { code }))).toBe('ROOM_NOT_FOUND')
  })

  it('members see their room and seats through RLS; outsiders see nothing', async () => {
    const { roomId, players } = await fullRoom()
    const outsider = await newPlayer()
    const { data: mine } = await players[1]!.client.from('room_players').select('seat').eq('room_id', roomId)
    expect(mine).toHaveLength(4)
    const { data: theirs } = await outsider.client.from('game_rooms').select('id').eq('id', roomId)
    expect(theirs).toEqual([])
  })

  it('an authenticated user cannot call the room RPCs directly', async () => {
    const p = await newPlayer()
    const { error } = await p.client.rpc('create_room', { p_user: p.userId })
    expect(error?.code).toBe('42501')
  })
})
