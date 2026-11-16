import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'
import type { CardCode } from './game-engine/cards.ts'
import type { Combination } from './game-engine/combination.ts'
import { applyAction } from './game-engine/gameState.ts'
import { resolveRuleset } from './game-engine/ruleset.ts'
import type { GameAction, MatchState } from './game-engine/state.ts'
import { callRpc } from './rpc.ts'

export interface ActionRequest {
  actionId: string
  matchId: string
  expectedVersion: number
  cards?: CardCode[]
}

export interface ActionResult {
  version: number
  state: unknown
  duplicate?: true
}

interface MatchRow {
  id: string
  status: 'PLAYING' | 'FINISHED' | 'ABORTED'
  version: number
  current_seat: number
  lead_seat: number
  current_trick: Combination | null
  passed_seats: number[]
  winner_seat: number | null
  game_rulesets: { config: unknown } | null
}

async function publicState(db: SupabaseClient, matchId: string): Promise<{ version: number; state: unknown }> {
  const state = await callRpc<{ version: number }>(db, 'match_public_state', { p_match: matchId })
  return { version: state.version, state }
}

/**
 * play-cards / pass-turn (ARCHITECTURE §4 steps 3–8): load state, early checks, run the engine,
 * then commit through apply_game_action, which re-checks everything under a row lock.
 */
export async function runAction(
  db: SupabaseClient,
  userId: string,
  type: GameAction['type'],
  req: ActionRequest,
): Promise<ActionResult> {
  // 3. load state
  const { data: match, error } = await db
    .from('matches')
    .select('id, status, version, current_seat, lead_seat, current_trick, passed_seats, winner_seat, game_rulesets(config)')
    .eq('id', req.matchId)
    .maybeSingle<MatchRow>()
  if (error) throw new ApiError('INTERNAL_ERROR')
  if (!match) throw new ApiError('MATCH_NOT_FOUND')

  const { data: players } = await db
    .from('match_players')
    .select('seat, user_id, has_played')
    .eq('match_id', req.matchId)
    .order('seat')
  // 4. membership
  const me = players?.find((p) => p.user_id === userId)
  if (!players || !me) throw new ApiError('NOT_ROOM_MEMBER')

  const alreadyDone = async () => {
    const { data } = await db
      .from('game_actions')
      .select('id')
      .eq('match_id', req.matchId)
      .eq('action_id', req.actionId)
      .maybeSingle()
    return data !== null
  }
  const replay = async (): Promise<ActionResult> => ({ ...(await publicState(db, req.matchId)), duplicate: true })

  // 5. early checks: a retried action returns the current state (idempotent)
  if (await alreadyDone()) return await replay()
  if (match.version !== req.expectedVersion) throw new ApiError('VERSION_CONFLICT')
  if (match.status !== 'PLAYING') throw new ApiError('MATCH_NOT_ACTIVE')

  const { data: hands } = await db.from('player_private_states').select('user_id, hand').eq('match_id', req.matchId)
  const handOf = new Map((hands ?? []).map((h) => [h.user_id as string, h.hand as CardCode[]]))

  const state: MatchState = {
    status: 'PLAYING',
    seats: players.map((p) => ({ hand: handOf.get(p.user_id) ?? [], hasPlayed: p.has_played })),
    currentSeat: match.current_seat,
    leadSeat: match.lead_seat,
    currentTrick: match.current_trick,
    passedSeats: match.passed_seats,
    winnerSeat: null,
  }

  // 6. engine
  const ruleset = resolveRuleset(match.game_rulesets?.config)
  const action: GameAction =
    type === 'PLAY' ? { type, seat: me.seat, cards: req.cards ?? [] } : { type, seat: me.seat }
  const result = applyAction(state, action, ruleset)
  if (!result.ok) {
    // The match row and the hands are separate reads. If another request committed in between,
    // the engine saw a mixed snapshot (e.g. old version, new hand → CARD_NOT_OWNED). Report what
    // really happened instead: our own action already landed, or the version moved on.
    if (await alreadyDone()) return await replay()
    const { data: now } = await db.from('matches').select('version').eq('id', req.matchId).single()
    if (now && now.version !== req.expectedVersion) throw new ApiError('VERSION_CONFLICT')
    throw new ApiError(result.error)
  }

  const next = result.value.nextState
  const played = result.value.events.find((e) => e.type === 'PLAYED')

  // 7. commit
  try {
    const committed = await callRpc<{ version: number }>(db, 'apply_game_action', {
      p_match: req.matchId,
      p_action_id: req.actionId,
      p_user: userId,
      p_expected_version: req.expectedVersion,
      p_action_type: type,
      p_cards: played ? [...played.combination.cards] : null,
      p_next: {
        status: next.status,
        currentSeat: next.currentSeat,
        leadSeat: next.leadSeat,
        currentTrick: next.currentTrick,
        passedSeats: next.passedSeats,
        winnerSeat: next.winnerSeat,
        combination: played ? played.combination.type : null,
      },
    })
    // 8. respond
    return { version: committed.version, state: committed }
  } catch (e) {
    // Same actionId raced in on another request and won: answer like a retry.
    if (e instanceof ApiError && e.code === 'ACTION_ALREADY_PROCESSED') return await replay()
    throw e
  }
}
