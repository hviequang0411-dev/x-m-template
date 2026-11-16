import { requireUserId } from '../_shared/auth.ts'
import { serviceClient } from '../_shared/db.ts'
import { handler, parseBody } from '../_shared/http.ts'
import { inBackground, runBots } from '../_shared/action.ts'
import { ApiError } from '../_shared/errors.ts'
import { shuffleAndDeal } from '../_shared/game-engine/deck.ts'
import { cryptoRandomInt } from '../_shared/game-engine/rng.ts'
import { playerRange, resolveRuleset } from '../_shared/game-engine/ruleset.ts'
import { chooseFirstLeader } from '../_shared/game-engine/turn.ts'
import { callRpc } from '../_shared/rpc.ts'
import { roomIdSchema } from '../_shared/schemas.ts'

// POST { roomId } → { matchId, version, ranked, state }. Host only; 2–4 seated players (v2).
// start_match re-checks everything: host, player count, locked accounts, the 10-point minimum for
// ranked matches (no bots), the deal, and that the previous winner leads.
Deno.serve(handler(async (req) => {
  const db = serviceClient()
  const userId = await requireUserId(req, db)
  const { roomId } = await parseBody(req, roomIdSchema)

  const { data: room } = await db
    .from('game_rooms')
    .select('id, last_winner_user_id, game_rulesets(config)')
    .eq('id', roomId)
    .maybeSingle<{ id: string; last_winner_user_id: string | null; game_rulesets: { config: unknown } | null }>()
  if (!room) throw new ApiError('ROOM_NOT_FOUND')
  const { data: seated } = await db
    .from('room_players')
    .select('user_id, seat')
    .eq('room_id', roomId)
    .eq('status', 'ACTIVE')
    .eq('role', 'PLAYER')
    .order('seat')
  const players = seated ?? []

  const ruleset = resolveRuleset(room.game_rulesets?.config)
  const { min, max } = playerRange(ruleset)
  if (players.length < min || players.length > max) throw new ApiError('NOT_ENOUGH_PLAYERS')

  const deal = shuffleAndDeal({ players: players.length, handSize: ruleset.handSize }, cryptoRandomInt)
  const winnerIx = players.findIndex((p) => p.user_id === room.last_winner_user_id)
  const firstSeat = chooseFirstLeader({ players: players.length }, cryptoRandomInt, winnerIx === -1 ? null : winnerIx)

  const state = await callRpc<{ matchId: string; version: number; ranked: boolean }>(db, 'start_match', {
    p_user: userId,
    p_room: roomId,
    p_hands: deal.hands.map((h) => h.map((c) => c.code)),
    p_first_seat: firstSeat,
  })
  inBackground(runBots(db, state.matchId)) // a bot may lead
  return { matchId: state.matchId, version: state.version, ranked: state.ranked, state }
}))
