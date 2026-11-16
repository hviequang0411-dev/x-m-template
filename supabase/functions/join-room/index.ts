import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { joinRoomSchema } from '../_shared/schemas.ts'

// POST { code } → { roomId, code, seat }
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { code } = await parseBody(req, joinRoomSchema)
  return await callRpc<object>(db, 'join_room', { p_user: userId, p_code: code })
}))
