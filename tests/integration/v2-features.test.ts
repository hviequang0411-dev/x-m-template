import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canBeat, classify, parseCards, sortCards, XAM_BASELINE_V2 as R, type Combination } from '@engine'
import { adminClient, call, errorCode, fullRoom, myHand, newPlayer, newPlayers, okBody, type Player, type PublicState } from './helpers'

type Started = { matchId: string; version: number; ranked: boolean; state: PublicState }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const stateOf = async (matchId: string) =>
  (await adminClient().rpc('match_public_state', { p_match: matchId })).data as PublicState & { ranked: boolean }

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

/** Plays the humans' turns (cheapest legal play, else pass) until the match ends; bots move on the server. */
async function playOut(matchId: string, humans: Player[], timeoutMs = 120_000): Promise<PublicState> {
  const started = Date.now()
  for (;;) {
    if (Date.now() - started > timeoutMs) throw new Error('match did not finish')
    const st = await stateOf(matchId)
    if (st.status !== 'PLAYING') return st
    const human = humans.find((h) => h.userId === st.seats[st.currentSeat]!.userId)
    if (!human) {
      await sleep(300) // a bot's turn: the server plays it
      continue
    }
    const play = cheapestPlay(await myHand(human, matchId), st.currentTrick as Combination | null)
    const body = { actionId: randomUUID(), matchId, expectedVersion: st.version }
    const r = play ? await call(human, 'play-cards', { ...body, cards: play }) : await call(human, 'pass-turn', body)
    if (!r.body.ok && errorCode(r) !== 'VERSION_CONFLICT') throw new Error(`unexpected ${errorCode(r)}`)
  }
}

async function roomWith(n: number) {
  const players = await newPlayers(n)
  const { roomId, code } = okBody(await call<{ roomId: string; code: string }>(players[0]!, 'create-room', {}))
  for (const p of players.slice(1)) okBody(await call(p, 'join-room', { code }))
  return { roomId, code, players }
}

describe('bots [R36]', () => {
  it('host adds bots; a 1-human + 2-bot match plays to the end on the server, unranked, points unchanged', async () => {
    const { roomId, players } = await roomWith(1)
    const host = players[0]!
    const admin = adminClient()
    // A human with 0 points may still play an unranked bot match.
    await admin.from('profiles').update({ total_score: 0 }).eq('id', host.userId)

    const b1 = okBody(await call<{ botId: string; seat: number }>(host, 'add-bot', { roomId }))
    const b2 = okBody(await call<{ botId: string; seat: number }>(host, 'add-bot', { roomId }))
    expect([b1.seat, b2.seat]).toEqual([1, 2])
    expect(b1.botId).not.toBe(b2.botId)
    const { data: bots } = await admin.from('profiles').select('id, is_bot, display_name').in('id', [b1.botId, b2.botId])
    expect(bots!.every((b) => b.is_bot && /^Máy \d+$/.test(b.display_name))).toBe(true)

    const started = okBody(await call<Started>(host, 'start-match', { roomId }))
    expect(started.ranked).toBe(false)
    const final = await playOut(started.matchId, [host])
    expect(final.status).toBe('FINISHED')

    const { data: actions } = await admin.from('game_actions').select('user_id, action_type').eq('match_id', started.matchId)
    const botMoves = actions!.filter((a) => a.user_id === b1.botId || a.user_id === b2.botId)
    expect(botMoves.length).toBeGreaterThan(0)
    expect(botMoves.every((a) => a.action_type === 'PLAY' || a.action_type === 'PASS')).toBe(true)

    const { count } = await admin.from('match_results').select('id', { count: 'exact', head: true }).eq('match_id', started.matchId)
    expect(count).toBe(0)
    const { data: me } = await admin.from('profiles').select('total_score, matches_played').eq('id', host.userId).single()
    expect(me).toEqual({ total_score: 0, matches_played: 0 })
  })

  it('only the host adds/removes bots, only into free seats, only while waiting; bots can be removed', async () => {
    const { roomId, players } = await roomWith(2)
    const [host, guest] = players
    expect(errorCode(await call(guest!, 'add-bot', { roomId }))).toBe('NOT_ROOM_HOST')
    const a = okBody(await call<{ botId: string }>(host!, 'add-bot', { roomId }))
    okBody(await call(host!, 'add-bot', { roomId }))
    expect(errorCode(await call(host!, 'add-bot', { roomId }))).toBe('ROOM_FULL')
    expect(errorCode(await call(guest!, 'remove-bot', { roomId, botId: a.botId }))).toBe('NOT_ROOM_HOST')
    expect(errorCode(await call(host!, 'remove-bot', { roomId, botId: guest!.userId }))).toBe('INVALID_REQUEST')
    okBody(await call(host!, 'remove-bot', { roomId, botId: a.botId }))
    const { count } = await adminClient().from('room_players').select('id', { count: 'exact', head: true }).eq('room_id', roomId).eq('status', 'ACTIVE')
    expect(count).toBe(3)

    okBody(await call(host!, 'start-match', { roomId }))
    expect(errorCode(await call(host!, 'add-bot', { roomId }))).toBe('MATCH_IN_PROGRESS')
  })
})

describe('waiting members [R37]', () => {
  it('someone joining mid-match waits, can watch without hands, and gets a seat when the match ends', async () => {
    const { roomId, code, players } = await roomWith(2)
    const { matchId } = okBody(await call<Started>(players[0]!, 'start-match', { roomId }))

    const late = await newPlayer()
    const joined = okBody(await call<{ role: string; seat: number | null }>(late, 'join-room', { code }))
    expect(joined).toMatchObject({ role: 'WAITING', seat: null })

    // Watching: the public match is readable, hands are not.
    const { data: match } = await late.client.from('matches').select('id, status').eq('id', matchId).maybeSingle()
    expect(match).toMatchObject({ id: matchId, status: 'PLAYING' })
    const { data: seats } = await late.client.from('match_players').select('seat').eq('match_id', matchId)
    expect(seats).toHaveLength(2)
    const { data: hands } = await late.client.from('player_private_states').select('hand').eq('match_id', matchId)
    expect(hands).toEqual([])
    // A waiting member can't act in the match.
    expect(errorCode(await call(late, 'pass-turn', { actionId: randomUUID(), matchId, expectedVersion: 1 }))).toBe('NOT_ROOM_MEMBER')

    await playOut(matchId, players)
    const { data: row } = await adminClient()
      .from('room_players').select('role, seat').eq('room_id', roomId).eq('user_id', late.userId).eq('status', 'ACTIVE').single()
    expect(row).toEqual({ role: 'PLAYER', seat: 2 })
  })

  it('a 5th member waits; when a seated player leaves the waiting room, the first in line takes the seat', async () => {
    const { roomId, code, players } = await fullRoom()
    const fifth = await newPlayer()
    const sixth = await newPlayer()
    okBody(await call(fifth, 'join-room', { code }))
    okBody(await call(sixth, 'join-room', { code }))
    okBody(await call(players[2]!, 'leave-room', { roomId }))
    const { data } = await adminClient()
      .from('room_players').select('user_id, role, seat').eq('room_id', roomId).eq('status', 'ACTIVE').order('joined_at')
    expect(data!.find((r) => r.user_id === fifth.userId)).toMatchObject({ role: 'PLAYER', seat: 2 })
    expect(data!.find((r) => r.user_id === sixth.userId)).toMatchObject({ role: 'WAITING', seat: null })
    // Waiting members may leave at any time.
    okBody(await call(sixth, 'leave-room', { roomId }))
  })
})

describe('points [R34, R35]', () => {
  it('new accounts start with 10 points; a ranked match needs 10 from every player', async () => {
    const { roomId, players } = await roomWith(2)
    const admin = adminClient()
    const { data } = await admin.from('profiles').select('total_score').in('id', players.map((p) => p.userId))
    expect(data!.map((d) => d.total_score)).toEqual([10, 10])
    await admin.from('profiles').update({ total_score: 9 }).eq('id', players[1]!.userId)
    const r = await call(players[0]!, 'start-match', { roomId })
    expect([r.status, errorCode(r)]).toEqual([409, 'NOT_ENOUGH_POINTS'])
  })
})

describe('admin [R38]', () => {
  it('lists, adjusts points with a logged reason, locks and unlocks; non-admins get NOT_ADMIN', async () => {
    const [boss, user] = await newPlayers(2)
    const admin = adminClient()
    expect(errorCode(await call(boss!, 'admin-users', {}))).toBe('NOT_ADMIN')
    await admin.from('profiles').update({ is_admin: true }).eq('id', boss!.userId)

    const listed = okBody(await call<{ users: { id: string; email: string; username: string }[] }>(boss!, 'admin-users', { query: user!.username }))
    expect(listed.users).toHaveLength(1)
    expect(listed.users[0]).toMatchObject({ id: user!.userId, email: `${user!.username}@xam.test` })

    expect(errorCode(await call(boss!, 'admin-adjust-points', { userId: user!.userId, delta: 20, reason: 'x' }))).toBe('INVALID_REQUEST')
    const added = okBody(await call<{ balance: number }>(boss!, 'admin-adjust-points', { userId: user!.userId, delta: 20, reason: 'Thưởng beta' }))
    expect(added.balance).toBe(30)
    expect(errorCode(await call(boss!, 'admin-adjust-points', { userId: user!.userId, delta: -31, reason: 'Trừ thử' }))).toBe('BALANCE_NEGATIVE')
    const { data: log } = await admin.from('point_adjustments').select('admin_id, delta, reason, balance_after').eq('user_id', user!.userId)
    expect(log).toEqual([{ admin_id: boss!.userId, delta: 20, reason: 'Thưởng beta', balance_after: 30 }])

    // The adjustment log is readable by admins only.
    expect((await user!.client.from('point_adjustments').select('id')).data).toEqual([])
    expect((await boss!.client.from('point_adjustments').select('id').eq('user_id', user!.userId)).data).toHaveLength(1)

    okBody(await call(boss!, 'admin-set-locked', { userId: user!.userId, locked: true }))
    const blocked = await call(user!, 'create-room', {})
    expect([blocked.status, errorCode(blocked)]).toEqual([403, 'ACCOUNT_LOCKED'])
    expect(errorCode(await call(boss!, 'admin-set-locked', { userId: boss!.userId, locked: true }))).toBe('INVALID_REQUEST')
    okBody(await call(boss!, 'admin-set-locked', { userId: user!.userId, locked: false }))
    okBody(await call(user!, 'create-room', {}))

    // Clients still can't make themselves admin or change their balance.
    const { error } = await user!.client.from('profiles').update({ is_admin: true, total_score: 999 }).eq('id', user!.userId)
    expect(error?.code).toBe('42501')
  })
})
