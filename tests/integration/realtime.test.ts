import { randomUUID } from 'node:crypto'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCards, sortCards } from '@engine'
import { call, fullRoom, myHand, newPlayer, okBody, type Player, type PublicState } from './helpers'

const channels: { player: Player; channel: RealtimeChannel }[] = []

afterEach(async () => {
  for (const { player, channel } of channels.splice(0)) await player.client.removeChannel(channel)
})

/** Subscribes to a private topic and resolves with the final subscribe status. */
async function subscribe(player: Player, topic: string, onEvent?: (event: string, payload: unknown) => void) {
  await player.client.realtime.setAuth(player.token)
  const channel = player.client.channel(topic, { config: { private: true } })
  channel.on('broadcast', { event: '*' }, (msg) => onEvent?.(msg.event, msg.payload))
  channels.push({ player, channel })
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 10_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer)
        resolve(status)
      }
    })
  })
}

describe('Realtime private channels (T5.5)', () => {
  it('members get the public state < 1 s after a play, without any hand; non-members cannot subscribe', async () => {
    const { roomId, players } = await fullRoom()
    const { matchId, state } = okBody(
      await call<{ matchId: string; state: PublicState }>(players[0]!, 'start-match', { roomId }),
    )

    const received: { at: number; payload: PublicState }[][] = players.map(() => [])
    const statuses = await Promise.all(
      players.map((p, i) =>
        subscribe(p, `match:${matchId}`, (event, payload) => {
          if (event === 'state') received[i]!.push({ at: Date.now(), payload: payload as PublicState })
        }),
      ),
    )
    expect(statuses).toEqual(['SUBSCRIBED', 'SUBSCRIBED', 'SUBSCRIBED', 'SUBSCRIBED'])

    const outsider = await newPlayer()
    expect(await subscribe(outsider, `match:${matchId}`)).toBe('CHANNEL_ERROR')

    const leader = players[state.currentSeat]!
    const hands = await Promise.all(players.map((p) => myHand(p, matchId)))
    const card = sortCards(parseCards(hands[state.currentSeat]!))[0]!.code
    const sentAt = Date.now()
    okBody(await call(leader, 'play-cards', { actionId: randomUUID(), matchId, expectedVersion: 1, cards: [card] }))

    const deadline = Date.now() + 5_000
    while (received.some((r) => r.length === 0) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
    for (const r of received) {
      expect(r).toHaveLength(1)
      expect(r[0]!.payload).toMatchObject({ version: 2, currentTrick: { cards: [card] } })
      expect(r[0]!.at - sentAt).toBeLessThan(1_000)
    }

    // No card that is still in someone's hand appears in the broadcast.
    const payloadText = JSON.stringify(received[0]![0]!.payload)
    const stillHidden = hands.flat().filter((c) => c !== card)
    expect(stillHidden.filter((c) => payloadText.includes(`"${c}"`))).toEqual([])
    expect(payloadText).not.toMatch(/hand/i)
  })

  it('room members are notified when someone joins or leaves; outsiders cannot listen', async () => {
    const host = await newPlayer()
    const { roomId, code } = okBody(await call<{ roomId: string; code: string }>(host, 'create-room', {}))
    const events: string[] = []
    expect(await subscribe(host, `room:${roomId}`, (e) => events.push(e))).toBe('SUBSCRIBED')

    const outsider = await newPlayer()
    expect(await subscribe(outsider, `room:${roomId}`)).toBe('CHANNEL_ERROR')
    expect(await subscribe(outsider, 'room:not-a-uuid')).toBe('CHANNEL_ERROR')

    okBody(await call(outsider, 'join-room', { code }))
    okBody(await call(outsider, 'leave-room', { roomId }))
    const deadline = Date.now() + 3_000
    while (events.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25))
    expect(events).toEqual(['players_changed', 'players_changed'])
  })
})
