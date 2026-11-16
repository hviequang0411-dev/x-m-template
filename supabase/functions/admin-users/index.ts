import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { adminListSchema } from '../_shared/schemas.ts'

// POST { query? } → { users: [...] }. Admins only (checked in admin_list_users). Includes emails.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { query } = await parseBody(req, adminListSchema)
  const users = await callRpc<unknown[]>(db, 'admin_list_users', { p_admin: userId, p_query: query ?? '', p_limit: 100 })
  return { users }
}))
