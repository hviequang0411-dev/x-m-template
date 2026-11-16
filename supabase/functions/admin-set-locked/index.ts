import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { adminLockSchema } from '../_shared/schemas.ts'

// POST { userId, locked } → { userId, locked }. Admins only; an admin can't lock themselves.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const body = await parseBody(req, adminLockSchema)
  return await callRpc<object>(db, 'admin_set_locked', { p_admin: userId, p_user: body.userId, p_locked: body.locked })
}))
