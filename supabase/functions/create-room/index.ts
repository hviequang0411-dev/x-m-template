import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { createRoomSchema } from '../_shared/schemas.ts'

// POST {} → { roomId, code, seat }
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  await parseBody(req, createRoomSchema)
  return await callRpc<object>(db, 'create_room', { p_user: userId })
}))
