import type { CardCode, Combination, CombinationType, MatchEndReason } from '@engine'
import { callFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'
import { HAND_SELECT, HISTORY_SELECT, MATCH_SELECT, RESULTS_SELECT } from '@/features/queries'

export interface MatchActionView {
  id: string
  version: number
  seat: number | null
  kind: 'DEAL' | 'PLAY' | 'PASS' | 'DECLARE_SAM' | 'ROUND_RESET' | 'ABORT'
  cards?: CardCode[]
  combination?: CombinationType | null
}

export interface SeatView {
  seat: number
  userId: string
  displayName: string
  cardCount: number
  hasPlayed: boolean
  status: 'PLAYING' | 'WON' | 'LOST' | 'FORFEITED'
  isBot: boolean
  avatarId?: string | null
  points?: number
}

/** Public match state: the same shape as the `state` broadcast (plus display names). */
export interface MatchView {
  matchId: string
  roomId: string
  hostId: string | null
  turnDeadline: string | null
  /** False when a bot plays: no points, no results, no history [R36]. */
  ranked: boolean
  version: number
  status: 'PLAYING' | 'FINISHED' | 'ABORTED'
  currentSeat: number
  leadSeat: number
  currentTrick: Combination | null
  passedSeats: number[]
  winnerSeat: number | null
  samSeat?: number | null
  foulSeat?: number | null
  endReason?: MatchEndReason | null
  actions?: MatchActionView[]
  seats: SeatView[]
}

type StoredTrick =
  | (Combination & { samSeat?: number | null; foulSeat?: number | null; endReason?: MatchEndReason | null })
  | { samOnly: true; samSeat: number }

interface MatchRow {
  id: string
  room_id: string
  turn_deadline: string | null
  ranked: boolean
  room: { host_id: string } | null
  version: number
  status: MatchView['status']
  current_seat: number
  lead_seat: number
  current_trick: StoredTrick | null
  passed_seats: number[]
  winner_seat: number | null
  players: {
    seat: number
    user_id: string
    card_count: number
    has_played: boolean
    status: SeatView['status']
    profile: { display_name: string; is_bot: boolean; avatar_id?: string | null; total_score?: number } | null
  }[]
}

function unpackTrick(raw: StoredTrick | null): {
  currentTrick: Combination | null
  samSeat: number | null
  foulSeat: number | null
  endReason: MatchEndReason | null
} {
  if (!raw) return { currentTrick: null, samSeat: null, foulSeat: null, endReason: null }
  if ('samOnly' in raw) {
    return { currentTrick: null, samSeat: raw.samSeat, foulSeat: null, endReason: null }
  }
  return {
    currentTrick: { type: raw.type, size: raw.size, keyRank: raw.keyRank, cards: raw.cards },
    samSeat: raw.samSeat ?? null,
    foulSeat: raw.foulSeat ?? null,
    endReason: raw.endReason ?? null,
  }
}

/** Reads the public state through RLS (seated players only). Null for non-players. */
export async function fetchMatch(matchId: string): Promise<MatchView | null> {
  const [{ data, error }, { data: rawActions }] = await Promise.all([
    supabase.from('matches').select(MATCH_SELECT).eq('id', matchId).maybeSingle<MatchRow>(),
    supabase
      .from('game_actions')
      .select('id, seat, action_type, cards, combination, version_after')
      .eq('match_id', matchId)
      .order('version_after', { ascending: false })
      .limit(16),
  ])
  if (error) throw new Error('MATCH_LOAD_FAILED')
  if (!data) return null
  const unpacked = unpackTrick(data.current_trick)
  const actions: MatchActionView[] = (rawActions ?? []).map((row: Record<string, unknown>) => {
    const rawType = String(row.action_type ?? 'PLAY')
    const kind: MatchActionView['kind'] =
      rawType === 'PLAY' || rawType === 'TIMEOUT_PLAY'
        ? 'PLAY'
        : rawType === 'PASS' || rawType === 'TIMEOUT_PASS'
          ? 'PASS'
          : rawType === 'DECLARE_SAM'
            ? 'DECLARE_SAM'
            : rawType === 'ABORT'
              ? 'ABORT'
              : 'DEAL'
    return {
      id: String(row.id ?? row.version_after),
      version: Number(row.version_after ?? 0),
      seat: typeof row.seat === 'number' ? row.seat : null,
      kind,
      cards: Array.isArray(row.cards) ? (row.cards as CardCode[]) : undefined,
      combination: (row.combination as CombinationType | null) ?? null,
    }
  })
  return {
    matchId: data.id,
    roomId: data.room_id,
    hostId: data.room?.host_id ?? null,
    turnDeadline: data.turn_deadline,
    ranked: data.ranked,
    version: data.version,
    status: data.status,
    currentSeat: data.current_seat,
    leadSeat: data.lead_seat,
    currentTrick: unpacked.currentTrick,
    passedSeats: data.passed_seats,
    winnerSeat: data.winner_seat,
    samSeat: unpacked.samSeat,
    foulSeat: unpacked.foulSeat,
    endReason: unpacked.endReason,
    actions,
    seats: [...data.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        userId: p.user_id,
        displayName: p.profile?.display_name ?? 'Người chơi',
        cardCount: p.card_count,
        hasPlayed: p.has_played,
        status: p.status,
        isBot: p.profile?.is_bot ?? false,
        avatarId: p.profile?.avatar_id ?? null,
        ...(typeof p.profile?.total_score === 'number' ? { points: p.profile.total_score } : {}),
      })),
  }
}

/** The caller's own hand (RLS: only your own row is readable). */
export async function fetchMyHand(matchId: string): Promise<CardCode[]> {
  const { data, error } = await supabase.from('player_private_states').select(HAND_SELECT).eq('match_id', matchId).maybeSingle()
  if (error) throw new Error('HAND_LOAD_FAILED')
  return (data?.hand as CardCode[] | undefined) ?? []
}

export const startMatch = (roomId: string) => callFunction<{ matchId: string; version: number }>('start-match', { roomId })

export const playCards = (matchId: string, expectedVersion: number, cards: CardCode[]) =>
  callFunction<{ version: number }>('play-cards', { actionId: crypto.randomUUID(), matchId, expectedVersion, cards })

export const passTurn = (matchId: string, expectedVersion: number) =>
  callFunction<{ version: number }>('pass-turn', { actionId: crypto.randomUUID(), matchId, expectedVersion })

export const declareSam = (matchId: string, expectedVersion: number) =>
  callFunction<{ version: number }>('pass-turn', {
    actionId: crypto.randomUUID(),
    matchId,
    expectedVersion,
    declareSam: true,
  })

export const claimTimeout = (matchId: string, expectedVersion: number) =>
  callFunction<{ version: number }>('claim-timeout', { actionId: crypto.randomUUID(), matchId, expectedVersion })

export const abortMatch = (matchId: string) => callFunction<{ version: number }>('finish-match', { matchId })

export interface ResultView {
  seat: number
  userId: string
  displayName: string
  isWinner: boolean
  remainingCards: number
  remainingHand: CardCode[]
  scoreDelta: number
  /** owed: what a capped loser should have paid (they paid their whole balance instead) [R35]. */
  penalties: {
    cong?: boolean
    thoi2?: number
    thoi2Cuoi?: boolean
    denSam?: boolean
    thoiTuQuy?: string[]
    owed?: number
  }
}

/** The results persisted by the server at match end (RLS: seated players). Never computed here. */
export async function fetchResults(matchId: string): Promise<ResultView[]> {
  const { data, error } = await supabase
    .from('match_results')
    .select(RESULTS_SELECT)
    .eq('match_id', matchId)
    .order('seat')
  if (error) throw new Error('RESULTS_LOAD_FAILED')
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      seat: number; user_id: string; is_winner: boolean; remaining_cards: number; remaining_hand: CardCode[]
      score_delta: number; penalties: ResultView['penalties']; profile: { display_name: string } | null
    }
    return {
      seat: row.seat,
      userId: row.user_id,
      displayName: row.profile?.display_name ?? 'Người chơi',
      isWinner: row.is_winner,
      remainingCards: row.remaining_cards,
      remainingHand: row.remaining_hand,
      scoreDelta: row.score_delta,
      penalties: row.penalties ?? {},
    }
  })
}

export interface HistoryEntry {
  matchId: string
  finishedAt: string | null
  roomCode: string | null
  isWinner: boolean
  remainingCards: number
  scoreDelta: number
  cong: boolean
}

/** The caller's last 50 results, newest first. */
export async function fetchMyHistory(userId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from('match_results')
    .select(HISTORY_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error('HISTORY_LOAD_FAILED')
  return (data ?? []).map((r) => {
    const row = r as unknown as {
      match_id: string; is_winner: boolean; remaining_cards: number; score_delta: number
      penalties: { cong?: boolean } | null; created_at: string
      match: { finished_at: string | null; room: { code: string } | null } | null
    }
    return {
      matchId: row.match_id,
      finishedAt: row.match?.finished_at ?? row.created_at,
      roomCode: row.match?.room?.code ?? null,
      isWinner: row.is_winner,
      remainingCards: row.remaining_cards,
      scoreDelta: row.score_delta,
      cong: row.penalties?.cong === true,
    }
  })
}
