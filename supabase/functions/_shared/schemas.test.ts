import { describe, expect, it } from 'vitest'
import { joinRoomSchema, passTurnSchema, playCardsSchema, roomIdSchema } from './schemas.ts'

const ids = {
  actionId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
  matchId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
}

describe('request schemas', () => {
  it('normalises a room code and rejects ambiguous characters', () => {
    expect(joinRoomSchema.parse({ code: ' abc234 ' })).toEqual({ code: 'ABC234' })
    for (const code of ['ABC23', 'ABC2345', 'ABC0DE', 'ABCIDE', 'ABC-23'])
      expect(joinRoomSchema.safeParse({ code }).success).toBe(false)
  })

  it('accepts a valid play and rejects bad cards, duplicates and extra keys', () => {
    expect(playCardsSchema.parse({ ...ids, expectedVersion: 3, cards: ['3S', 'TH'] }).cards).toEqual(['3S', 'TH'])
    const bad = [
      { ...ids, expectedVersion: 3, cards: [] },
      { ...ids, expectedVersion: 3, cards: ['3S', '3S'] },
      { ...ids, expectedVersion: 3, cards: ['10H'] },
      { ...ids, expectedVersion: -1, cards: ['3S'] },
      { ...ids, expectedVersion: 1.5, cards: ['3S'] },
      { ...ids, actionId: 'nope', expectedVersion: 1, cards: ['3S'] },
      { ...ids, expectedVersion: 1, cards: ['3S'], seat: 0 },
    ]
    for (const body of bad) expect(playCardsSchema.safeParse(body).success).toBe(false)
  })

  it('a pass carries no cards', () => {
    expect(passTurnSchema.safeParse({ ...ids, expectedVersion: 2 }).success).toBe(true)
    expect(passTurnSchema.safeParse({ ...ids, expectedVersion: 2, cards: ['3S'] }).success).toBe(false)
  })

  it('roomId must be a uuid', () => {
    expect(roomIdSchema.safeParse({ roomId: ids.matchId }).success).toBe(true)
    expect(roomIdSchema.safeParse({ roomId: '123' }).success).toBe(false)
  })
})
