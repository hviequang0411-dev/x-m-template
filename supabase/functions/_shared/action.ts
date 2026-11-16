import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'
import { chooseBotMove } from './game-engine/bot.ts'
import type { CardCode } from './game-engine/cards.ts'
import type { Combination } from './game-engine/combination.ts'
import { applyAction, timeoutAction } from './game-engine/gameState.ts'
import { resolveRuleset, type GameRuleSet } from './game-engine/ruleset.ts'
import { calculateScores } from './game-engine/score.ts'
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

/** PLAY / PASS by the caller, or TIMEOUT: any seated player claims an expired turn (R27). */
export type ActionKind = 'PLAY' | 'PASS' | 'TIMEOUT'

interface MatchRow {
  id: string
  status: 'PLAYING' | 'FINISHED' | 'ABORTED'
  version: number
  ranked: boolean
  current_seat: number
  lead_seat: number
  current_trick: Combination | null
  passed_seats: number[]
  winner_seat: number | null
  turn_deadline: string | null
  game_rulesets: { config: unknown } | null
}

interface PlayerRow {
  seat: number
  user_id: string
  has_played: boolean
  profile: { is_bot: boolean } | null
}

export interface LoadedMatch {
  match: MatchRow
  players: PlayerRow[]
  state: MatchState
  ruleset: GameRuleSet
}

/** Loads the authoritative state of a PLAYING match (service role: includes every hand). */
export async function loadMatch(db: SupabaseClient, matchId: string): Promise<LoadedMatch> {
  const { data: match, error } = await db
    .from('matches')
    .select(
      'id, status, version, ranked, current_seat, lead_seat, current_trick, passed_seats, winner_seat, turn_deadline, game_rulesets(config)',
    )
    .eq('id', matchId)
    .maybeSingle<MatchRow>()
  if (error) throw new ApiError('INTERNAL_ERROR')
  if (!match) throw new ApiError('MATCH_NOT_FOUND')

  const { data: players } = await db
    .from('match_players')
    .select('seat, user_id, has_played, profile:profiles(is_bot)')
    .eq('match_id', matchId)
    .order('seat')
    .returns<PlayerRow[]>()
  const { data: hands } = await db.from('player_private_states').select('user_id, hand').eq('match_id', matchId)
  const handOf = new Map((hands ?? []).map((h) => [h.user_id as string, h.hand as CardCode[]]))

  const state: MatchState = {
    status: 'PLAYING',
    seats: (players ?? []).map((p) => ({ hand: handOf.get(p.user_id) ?? [], hasPlayed: p.has_played })),
    currentSeat: match.current_seat,
    leadSeat: match.lead_seat,
    currentTrick: match.current_trick,
    passedSeats: match.passed_seats,
    winnerSeat: null,
  }
  return { match, players: players ?? [], state, ruleset: resolveRuleset(match.game_rulesets?.config) }
}

async function publicState(db: SupabaseClient, matchId: string): Promise<{ version: number; state: unknown }> {
  const state = await callRpc<{ version: number }>(db, 'match_public_state', { p_match: matchId })
  return { version: state.version, state }
}

/** Commits an engine transition through apply_game_action (which re-checks everything under a row lock). */
async function commit(
  db: SupabaseClient,
  loaded: LoadedMatch,
  userId: string,
  actionId: string,
  action: GameAction,
  timeout: boolean,
): Promise<{ version: number }> {
  const result = applyAction(loaded.state, action, loaded.ruleset)
  if (!result.ok) throw new ApiError(result.error)
  const next = result.value.nextState
  const played = result.value.events.find((e) => e.type === 'PLAYED')
  const dbType = timeout ? (action.type === 'PLAY' ? 'TIMEOUT_PLAY' : 'TIMEOUT_PASS') : action.type
  return callRpc<{ version: number }>(db, 'apply_game_action', {
    p_match: loaded.match.id,
    p_action_id: actionId,
    p_user: userId,
    p_expected_version: loaded.match.version,
    p_action_type: dbType,
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
    // Ranked only: amounts OWED from the engine; the RPC verifies them and applies the balance cap.
    p_results: next.status === 'FINISHED' && loaded.match.ranked ? calculateScores(next, loaded.ruleset) : null,
  })
}

/**
 * play-cards / pass-turn / claim-timeout (ARCHITECTURE §4 steps 3–8): load state, early checks,
 * run the engine, commit. Afterwards the server plays any bots whose turn it is.
 */
export async function runAction(
  db: SupabaseClient,
  userId: string,
  kind: ActionKind,
  req: ActionRequest,
): Promise<ActionResult> {
  // 3. load state
  const loaded = await loadMatch(db, req.matchId)
  const { match, players, state, ruleset } = loaded
  // 4. membership
  const me = players.find((p) => p.user_id === userId)
  if (!me) throw new ApiError('NOT_ROOM_MEMBER')

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
  const versionMoved = async () => {
    const { data: now } = await db.from('matches').select('version').eq('id', req.matchId).single()
    return !!now && now.version !== req.expectedVersion
  }

  // 5. early checks: a retried action returns the current state (idempotent)
  if (await alreadyDone()) return await replay()
  if (match.version !== req.expectedVersion) throw new ApiError('VERSION_CONFLICT')
  if (match.status !== 'PLAYING') throw new ApiError('MATCH_NOT_ACTIVE')
  // Fail fast on an early claim; the RPC re-checks with the database clock.
  if (kind === 'TIMEOUT' && (!match.turn_deadline || Date.parse(match.turn_deadline) > Date.now()))
    throw new ApiError('TURN_NOT_EXPIRED')

  // 6. engine
  const action: GameAction | null =
    kind === 'TIMEOUT'
      ? timeoutAction(state, ruleset)
      : kind === 'PLAY'
        ? { type: 'PLAY', seat: me.seat, cards: req.cards ?? [] }
        : { type: 'PASS', seat: me.seat }
  if (!action) throw new ApiError('MATCH_NOT_ACTIVE')

  // 7. commit
  let committed: { version: number }
  try {
    committed = await commit(db, loaded, userId, req.actionId, action, kind === 'TIMEOUT')
  } catch (e) {
    if (!(e instanceof ApiError)) throw e
    // Same actionId raced in on another request and won: answer like a retry.
    if (e.code === 'ACTION_ALREADY_PROCESSED') return await replay()
    // An engine rejection may come from a mixed snapshot (another request committed between our
    // reads): report what really happened instead.
    if (e.code !== 'VERSION_CONFLICT' && e.code !== 'INTERNAL_ERROR') {
      if (await alreadyDone()) return await replay()
      if (await versionMoved()) throw new ApiError('VERSION_CONFLICT')
    }
    throw e
  }

  inBackground(runBots(db, req.matchId))
  // 8. respond
  return { version: committed.version, state: committed }
}

/** Runs work after the response when the Edge Runtime supports it; otherwise just lets it run. */
export function inBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  const guarded = work.catch((e) => console.error('background task failed', e))
  if (runtime) runtime.waitUntil(guarded)
}

const BOT_DELAY_MS = 800
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Plays every consecutive bot turn of a match [R36], one move per ~0.8 s so humans can follow.
 * Stops at a human's turn or the end of the match. Safe to run concurrently: each move is a normal
 * versioned action, so a lost race is just a VERSION_CONFLICT and the loop re-reads the state.
 * If this ever stops early, a human's claim-timeout makes the bot auto-play and restarts it.
 */
export async function runBots(db: SupabaseClient, matchId: string): Promise<number> {
  let moves = 0
  for (let i = 0; i < 80; i++) {
    const loaded = await loadMatch(db, matchId)
    if (loaded.match.status !== 'PLAYING') break
    const current = loaded.players.find((p) => p.seat === loaded.match.current_seat)
    if (!current?.profile?.is_bot) break
    await sleep(BOT_DELAY_MS)
    const fresh = await loadMatch(db, matchId)
    if (fresh.match.version !== loaded.match.version) continue
    try {
      await commit(db, fresh, current.user_id, crypto.randomUUID(), chooseBotMove(fresh.state, fresh.ruleset), false)
      moves++
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') continue
      throw e
    }
  }
  return moves
}
