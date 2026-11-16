import { z } from 'zod'
import { isCardCode, type CardCode } from './game-engine/cards.ts'

const cardCode = z.string().refine(isCardCode, 'invalid card').transform((c) => c as CardCode)

export const createRoomSchema = z.object({}).strict()

export const joinRoomSchema = z
  .object({ code: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/) })
  .strict()

export const roomIdSchema = z.object({ roomId: z.uuid() }).strict()

const actionBase = {
  actionId: z.uuid(),
  matchId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
}

export const playCardsSchema = z
  .object({
    ...actionBase,
    cards: z
      .array(cardCode)
      .min(1)
      .max(10)
      .refine((cs) => new Set(cs).size === cs.length, 'duplicate cards'),
  })
  .strict()

export const passTurnSchema = z.object(actionBase).strict()

export const claimTimeoutSchema = z.object(actionBase).strict()

export const matchIdSchema = z.object({ matchId: z.uuid() }).strict()

export type PlayCardsBody = z.infer<typeof playCardsSchema>
export type PassTurnBody = z.infer<typeof passTurnSchema>

export const removeBotSchema = z.object({ roomId: z.uuid(), botId: z.uuid() }).strict()

export const adminListSchema = z.object({ query: z.string().max(100).optional() }).strict()

export const adminAdjustSchema = z
  .object({
    userId: z.uuid(),
    delta: z.number().int().refine((d) => d !== 0 && Math.abs(d) <= 100_000, 'delta'),
    reason: z.string().trim().min(3).max(200),
  })
  .strict()

export const adminLockSchema = z.object({ userId: z.uuid(), locked: z.boolean() }).strict()
