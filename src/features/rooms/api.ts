import { callFunction } from '@/lib/functions'
import { supabase } from '@/lib/supabase'
import { fetchRoomScoreStats } from '@/features/match/api'
import { ACTIVE_ROOM_SELECT, ROOM_SELECT } from '@/features/queries'

export type RoomStatus = 'WAITING' | 'PLAYING' | 'CLOSED'

export interface ActiveRoom {
  roomId: string
  code: string
  status: RoomStatus
  seat: number | null
  role: 'PLAYER' | 'WAITING'
}

interface ActiveRoomRow {
  seat: number | null
  role: 'PLAYER' | 'WAITING'
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
  return { roomId: data.room.id, code: data.room.code, status: data.room.status, seat: data.seat, role: data.role }
}

export interface RoomPlayer {
  seat: number | null
  userId: string
  displayName: string
  isBot: boolean
  points: number
  avatarId?: string | null
  roomDelta?: number
  roomWins?: number
}

export interface RoomView {
  id: string
  code: string
  status: RoomStatus
  hostId: string
  currentMatchId: string | null
  /** Seated players, by seat (2–5 play a match). */
  players: RoomPlayer[]
  /** Waiting members, in join order: they get a free seat when the room is waiting [R37]. */
  waiting: RoomPlayer[]
}

interface RoomRow {
  id: string
  code: string
  status: RoomStatus
  host_id: string
  current_match_id: string | null
  players: {
    seat: number | null
    role: 'PLAYER' | 'WAITING'
    user_id: string
    status: string
    joined_at: string
    profile: { display_name: string; is_bot: boolean; total_score: number; avatar_id?: string | null } | null
  }[]
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
  const roomStats = await fetchRoomScoreStats(data.id)
  const active = data.players.filter((p) => p.status === 'ACTIVE')
  const toPlayer = (p: RoomRow['players'][number]): RoomPlayer => ({
    seat: p.seat,
    userId: p.user_id,
    displayName: p.profile?.display_name ?? 'Người chơi',
    isBot: p.profile?.is_bot ?? false,
    points: p.profile?.total_score ?? 0,
    avatarId: p.profile?.avatar_id ?? null,
    roomDelta: roomStats.get(p.user_id)?.delta ?? 0,
    roomWins: roomStats.get(p.user_id)?.wins ?? 0,
  })
  return {
    id: data.id,
    code: data.code,
    status: data.status,
    hostId: data.host_id,
    currentMatchId: data.current_match_id,
    players: active
      .filter((p) => p.role === 'PLAYER')
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0))
      .map(toPlayer),
    waiting: active
      .filter((p) => p.role === 'WAITING')
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map(toPlayer),
  }
}

export const createRoom = () => callFunction<{ roomId: string; code: string; seat: number }>('create-room', {})
export const joinRoom = (code: string) =>
  callFunction<{ roomId: string; code: string; seat: number | null; role: 'PLAYER' | 'WAITING' }>('join-room', { code })
export const addBot = (roomId: string) => callFunction<{ botId: string; seat: number }>('add-bot', { roomId })
export const removeBot = (roomId: string, botId: string) => callFunction<{ removed: true }>('remove-bot', { roomId, botId })
export const leaveRoom = (roomId: string) => callFunction<{ roomId: string }>('leave-room', { roomId })
