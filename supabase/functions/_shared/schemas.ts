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

export type PlayCardsBody = z.infer<typeof playCardsSchema>
export type PassTurnBody = z.infer<typeof passTurnSchema>
