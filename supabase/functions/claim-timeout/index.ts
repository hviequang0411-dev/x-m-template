import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { runAction } from '../_shared/action.ts'
import { claimTimeoutSchema } from '../_shared/schemas.ts'

// POST { actionId, matchId, expectedVersion } → { version, state, duplicate? }
// Any seated player may claim once the turn deadline has passed: the current seat auto-passes,
// or auto-plays its lowest single when it leads (R27). Early claims → TURN_NOT_EXPIRED.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const body = await parseBody(req, claimTimeoutSchema)
  return await runAction(db, userId, 'TIMEOUT', body)
}))
