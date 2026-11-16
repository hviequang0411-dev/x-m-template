import type { CardCode, Combination } from '@engine'
import { callFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'

export interface SeatView {
  seat: number
  userId: string
  displayName: string
  cardCount: number
  hasPlayed: boolean
  status: 'PLAYING' | 'WON' | 'LOST' | 'FORFEITED'
}

/** Public match state: the same shape as the `state` broadcast (plus display names). */
export interface MatchView {
  matchId: string
  roomId: string
  version: number
  status: 'PLAYING' | 'FINISHED' | 'ABORTED'
  currentSeat: number
  leadSeat: number
  currentTrick: Combination | null
  passedSeats: number[]
  winnerSeat: number | null
  seats: SeatView[]
}

interface MatchRow {
  id: string
  room_id: string
  version: number
  status: MatchView['status']
  current_seat: number
  lead_seat: number
  current_trick: Combination | null
  passed_seats: number[]
  winner_seat: number | null
  players: {
    seat: number
    user_id: string
    card_count: number
    has_played: boolean
    status: SeatView['status']
    profile: { display_name: string } | null
  }[]
}

/** Reads the public state through RLS (seated players only). Null for non-players. */
export async function fetchMatch(matchId: string): Promise<MatchView | null> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, room_id, version, status, current_seat, lead_seat, current_trick, passed_seats, winner_seat, ' +
        'players:match_players(seat, user_id, card_count, has_played, status, profile:profiles(display_name))',
    )
    .eq('id', matchId)
    .maybeSingle<MatchRow>()
  if (error) throw new Error('MATCH_LOAD_FAILED')
  if (!data) return null
  return {
    matchId: data.id,
    roomId: data.room_id,
    version: data.version,
    status: data.status,
    currentSeat: data.current_seat,
    leadSeat: data.lead_seat,
    currentTrick: data.current_trick,
    passedSeats: data.passed_seats,
    winnerSeat: data.winner_seat,
    seats: [...data.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        userId: p.user_id,
        displayName: p.profile?.display_name ?? 'Người chơi',
        cardCount: p.card_count,
        hasPlayed: p.has_played,
        status: p.status,
      })),
  }
}

/** The caller's own hand (RLS: only your own row is readable). */
export async function fetchMyHand(matchId: string): Promise<CardCode[]> {
  const { data, error } = await supabase.from('player_private_states').select('hand').eq('match_id', matchId).maybeSingle()
  if (error) throw new Error('HAND_LOAD_FAILED')
  return (data?.hand as CardCode[] | undefined) ?? []
}

export const startMatch = (roomId: string) => callFunction<{ matchId: string; version: number }>('start-match', { roomId })

export const playCards = (matchId: string, expectedVersion: number, cards: CardCode[]) =>
  callFunction<{ version: number }>('play-cards', { actionId: crypto.randomUUID(), matchId, expectedVersion, cards })

export const passTurn = (matchId: string, expectedVersion: number) =>
  callFunction<{ version: number }>('pass-turn', { actionId: crypto.randomUUID(), matchId, expectedVersion })
