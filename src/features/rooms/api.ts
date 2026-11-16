import { supabase } from '@/lib/supabase'

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
    .select('seat, room:game_rooms!inner(id, code, status)')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE')
    .maybeSingle<ActiveRoomRow>()
  if (error) throw new Error('ROOM_LOAD_FAILED')
  if (!data) return null
  return { roomId: data.room.id, code: data.room.code, status: data.room.status, seat: data.seat }
}
