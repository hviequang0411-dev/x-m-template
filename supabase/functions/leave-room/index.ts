import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { roomIdSchema } from '../_shared/schemas.ts'

// POST { roomId } → { roomId, left } (WAITING rooms only)
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { roomId } = await parseBody(req, roomIdSchema)
  return await callRpc<object>(db, 'leave_room', { p_user: userId, p_room: roomId })
}))
