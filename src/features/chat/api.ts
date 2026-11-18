import { supabase } from '@/lib/supabase'
import { CHAT_SELECT } from '@/features/queries'

export const CHAT_MAX_LENGTH = 200
/** How many earlier messages a room shows when opened. */
export const CHAT_HISTORY_LIMIT = 50

export interface ChatMessage {
  id: number
  roomId: string
  userId: string
  displayName: string
  kind: 'TEXT' | 'EMOTE'
  body: string
  createdAt: string
}

const ERROR_TEXT: Record<string, string> = {
  RATE_LIMITED: 'Bạn gửi nhanh quá, chờ vài giây rồi gửi tiếp nhé.',
  INVALID_MESSAGE: `Tin nhắn từ 1 đến ${CHAT_MAX_LENGTH} ký tự.`,
  NOT_ROOM_MEMBER: 'Bạn không còn ở trong phòng này.',
  ACCOUNT_LOCKED: 'Tài khoản đang bị khoá, không thể trò chuyện.',
  NOT_AUTHENTICATED: 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại.',
}

export class ChatError extends Error {
  code: string
  constructor(code: string) {
    super(ERROR_TEXT[code] ?? 'Không gửi được, vui lòng thử lại.')
    this.code = code
  }
}

/** Parses a `chat` broadcast payload (or an RPC result). Null when it is not a chat message. */
export function toChatMessage(p: Record<string, unknown>): ChatMessage | null {
  const id = typeof p.id === 'number' ? p.id : typeof p.id === 'string' ? Number(p.id) : NaN
  if (!Number.isFinite(id)) return null
  if (typeof p.roomId !== 'string' || typeof p.userId !== 'string' || typeof p.body !== 'string') return null
  if (p.kind !== 'TEXT' && p.kind !== 'EMOTE') return null
  return {
    id,
    roomId: p.roomId,
    userId: p.userId,
    displayName: typeof p.displayName === 'string' ? p.displayName : 'Người chơi',
    kind: p.kind,
    body: p.body,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
  }
}

interface ChatRow {
  id: number
  room_id: string
  user_id: string
  kind: 'TEXT' | 'EMOTE'
  body: string
  created_at: string
  profile: { display_name: string } | null
}

/** The latest messages of a room, oldest first. RLS: members only, since they joined. */
export async function fetchRoomMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('room_messages')
    .select(CHAT_SELECT)
    .eq('room_id', roomId)
    .order('id', { ascending: false })
    .limit(CHAT_HISTORY_LIMIT)
    .returns<ChatRow[]>()
  if (error) throw new Error('CHAT_LOAD_FAILED')
  return (data ?? [])
    .map((r) => ({
      id: Number(r.id),
      roomId: r.room_id,
      userId: r.user_id,
      displayName: r.profile?.display_name ?? 'Người chơi',
      kind: r.kind,
      body: r.body,
      createdAt: r.created_at,
    }))
    .reverse()
}

/** Sends a chat line or an emote. The server checks membership, length and the rate limit. */
export async function sendRoomMessage(roomId: string, kind: 'TEXT' | 'EMOTE', body: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_room_message', { p_room: roomId, p_kind: kind, p_body: body })
  if (error) throw new ChatError(error.message)
  const msg = data && typeof data === 'object' ? toChatMessage(data as Record<string, unknown>) : null
  if (!msg) throw new ChatError('UNKNOWN')
  return msg
}
