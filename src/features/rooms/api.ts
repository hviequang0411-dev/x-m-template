import { callFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'
import { ACTIVE_ROOM_SELECT, ROOM_SELECT } from '@/features/queries'

export type RoomStatus = 'WAITING' | 'PLAYING' | 'CLOSED'

export interface ActiveRoom {
  roomId: string
  code: string
  status: RoomStatus
  seat: number
}

interface ActiveRoomRow {
  seat: number
  room: { id: string; code: string; status: RoomStatus }
}

/** The caller's current room, if any (a user is ACTIVE in at most one room). RLS-filtered. */
export async function fetchMyActiveRoom(userId: string): Promise<ActiveRoom | null> {
  const { data, error } = await supabase
    .from('room_players')
    .select(ACTIVE_ROOM_SELECT)
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle<ActiveRoomRow>()
  if (error) throw new Error('ROOM_LOAD_FAILED')
  if (!data) return null
  return { roomId: data.room.id, code: data.room.code, status: data.room.status, seat: data.seat }
}

export interface RoomPlayer {
  seat: number
  userId: string
  displayName: string
}

export interface RoomView {
  id: string
  code: string
  status: RoomStatus
  hostId: string
  currentMatchId: string | null
  players: RoomPlayer[]
}

interface RoomRow {
  id: string
  code: string
  status: RoomStatus
  host_id: string
  current_match_id: string | null
  players: { seat: number; user_id: string; status: string; profile: { display_name: string } | null }[]
}

/** The room and its active seats. Null when the caller isn't a member (RLS hides the row). */
export async function fetchRoom(roomId: string): Promise<RoomView | null> {
  const { data, error } = await supabase
    .from('game_rooms')
    .select(ROOM_SELECT)
    .eq('id', roomId)
    .maybeSingle<RoomRow>()
  if (error) throw new Error('ROOM_LOAD_FAILED')
  if (!data) return null
  return {
    id: data.id,
    code: data.code,
    status: data.status,
    hostId: data.host_id,
    currentMatchId: data.current_match_id,
    players: data.players
      .filter((p) => p.status === 'ACTIVE')
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ seat: p.seat, userId: p.user_id, displayName: p.profile?.display_name ?? 'Người chơi' })),
  }
}

export const createRoom = () => callFunction<{ roomId: string; code: string; seat: number }>('create-room', {})
export const joinRoom = (code: string) => callFunction<{ roomId: string; code: string; seat: number }>('join-room', { code })
export const leaveRoom = (roomId: string) => callFunction<{ roomId: string }>('leave-room', { roomId })
