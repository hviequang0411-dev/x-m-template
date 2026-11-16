import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { adminAdjustSchema } from '../_shared/schemas.ts'

// POST { userId, delta, reason } → { userId, balance }. Admins only; logged in point_adjustments.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const body = await parseBody(req, adminAdjustSchema)
  return await callRpc<object>(db, 'admin_adjust_points', {
    p_admin: userId, p_user: body.userId, p_delta: body.delta, p_reason: body.reason,
  })
}))
