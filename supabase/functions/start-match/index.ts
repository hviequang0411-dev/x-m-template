import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { ApiError } from '../_shared/errors.ts'
import { shuffleAndDeal } from '../_shared/game-engine/deck.ts'
import { cryptoRandomInt } from '../_shared/game-engine/rng.ts'
import { resolveRuleset } from '../_shared/game-engine/ruleset.ts'
import { chooseFirstLeader } from '../_shared/game-engine/turn.ts'
import { callRpc } from '../_shared/rpc.ts'
import { roomIdSchema } from '../_shared/schemas.ts'

// POST { roomId } → { matchId, version, state }. Host only, exactly 4 players (checked in start_match).
// The shuffle uses crypto RNG and happens here; the RPC validates the deal and stores private hands.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { roomId } = await parseBody(req, roomIdSchema)

  const { data: room } = await db
    .from('game_rooms')
    .select('id, last_winner_seat, game_rulesets(config)')
    .eq('id', roomId)
    .maybeSingle<{ id: string; last_winner_seat: number | null; game_rulesets: { config: unknown } | null }>()
  if (!room) throw new ApiError('ROOM_NOT_FOUND')

  const ruleset = resolveRuleset(room.game_rulesets?.config)
  const deal = shuffleAndDeal(ruleset, cryptoRandomInt)
  const firstSeat = chooseFirstLeader(ruleset, cryptoRandomInt, room.last_winner_seat)

  const state = await callRpc<{ matchId: string; version: number }>(db, 'start_match', {
    p_user: userId,
    p_room: roomId,
    p_hands: deal.hands.map((h) => h.map((c) => c.code)),
    p_first_seat: firstSeat,
  })
  return { matchId: state.matchId, version: state.version, state }
}))
