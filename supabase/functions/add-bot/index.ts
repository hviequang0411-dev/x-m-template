import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { idleOrNewBot, createBot } from '../_shared/bots.ts'
import { ApiError } from '../_shared/errors.ts'
import { callRpc } from '../_shared/rpc.ts'
import { roomIdSchema } from '../_shared/schemas.ts'

// POST { roomId } → { roomId, botId, seat }. Host only, while the room is WAITING (R36).
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { roomId } = await parseBody(req, roomIdSchema)
  let botId = await idleOrNewBot(db)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callRpc<object>(db, 'add_bot', { p_user: userId, p_room: roomId, p_bot: botId })
    } catch (e) {
      // Another room took this idle bot at the same moment (one active room per account): use a new one.
      if (e instanceof ApiError && e.code === 'ALREADY_IN_ROOM') botId = await createBot(db)
      else throw e
    }
  }
  throw new ApiError('INTERNAL_ERROR')
}))
