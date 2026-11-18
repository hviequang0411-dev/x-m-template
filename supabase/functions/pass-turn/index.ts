import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { runAction } from '../_shared/action.ts'
import { passTurnSchema } from '../_shared/schemas.ts'

// POST { actionId, matchId, expectedVersion, declareSam? } → { version, state, duplicate? }
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const body = await parseBody(req, passTurnSchema)
  return await runAction(db, userId, body.declareSam ? 'DECLARE_SAM' : 'PASS', body)
}))
