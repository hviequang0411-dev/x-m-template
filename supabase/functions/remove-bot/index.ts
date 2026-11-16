import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { removeBotSchema } from '../_shared/schemas.ts'

// POST { roomId, botId } → { roomId, botId, removed }. Host only, while the room is WAITING.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { roomId, botId } = await parseBody(req, removeBotSchema)
  return await callRpc<object>(db, 'remove_bot', { p_user: userId, p_room: roomId, p_bot: botId })
}))
