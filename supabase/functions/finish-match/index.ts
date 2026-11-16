import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { callRpc } from '../_shared/rpc.ts'
import { matchIdSchema } from '../_shared/schemas.ts'

// POST { matchId } → { version, state }. Abort only, never a winner claim (R30):
// the host may abort a match with no move for more than 5 minutes.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { matchId } = await parseBody(req, matchIdSchema)
  const state = await callRpc<{ version: number }>(db, 'finish_match', { p_user: userId, p_match: matchId })
  return { version: state.version, state }
}))
