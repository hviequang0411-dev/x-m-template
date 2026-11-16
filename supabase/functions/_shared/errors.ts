/**
 * The one list of API error codes, their HTTP status and Vietnamese message (ARCHITECTURE §8).
 * Pure TypeScript: used by the Edge Functions and imported by the frontend (`@shared/errors`).
 */
import { MOVE_ERROR_CODES, type MoveErrorCode } from './game-engine/state.ts'

export const API_ERRORS = {
  // request / auth
  INVALID_REQUEST: { status: 400, message: 'Yêu cầu không hợp lệ' },
  UNAUTHORIZED: { status: 401, message: 'Vui lòng đăng nhập lại' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Phương thức không được hỗ trợ' },
  // rooms
  ROOM_NOT_FOUND: { status: 404, message: 'Không tìm thấy phòng' },
  ROOM_FULL: { status: 409, message: 'Phòng đã đủ 4 người' },
  ALREADY_IN_ROOM: { status: 409, message: 'Bạn đang ở trong một phòng khác' },
  NOT_ROOM_MEMBER: { status: 403, message: 'Bạn không ở trong phòng này' },
  NOT_ROOM_HOST: { status: 403, message: 'Chỉ chủ phòng mới làm được việc này' },
  NOT_ENOUGH_PLAYERS: { status: 409, message: 'Cần ít nhất 2 người chơi để bắt đầu' },
  NOT_ENOUGH_POINTS: { status: 409, message: 'Mỗi người chơi cần ít nhất 10 điểm để chơi ván tính điểm' },
  ACCOUNT_LOCKED: { status: 403, message: 'Tài khoản đang bị khoá' },
  MATCH_IN_PROGRESS: { status: 409, message: 'Ván đang diễn ra' },
  // matches
  MATCH_NOT_FOUND: { status: 404, message: 'Không tìm thấy ván' },
  MATCH_NOT_ACTIVE: { status: 409, message: 'Ván đã kết thúc' },
  MATCH_NOT_STALLED: { status: 409, message: 'Chỉ huỷ được ván khi không ai đánh trong 5 phút' },
  VERSION_CONFLICT: { status: 409, message: 'Bàn chơi vừa thay đổi, đang tải lại' },
  ACTION_ALREADY_PROCESSED: { status: 409, message: 'Nước đi này đã được xử lý' },
  NOT_YOUR_TURN: { status: 409, message: 'Chưa đến lượt bạn' },
  LEADER_CANNOT_PASS: { status: 409, message: 'Bạn đang dẫn vòng nên không được bỏ lượt' },
  CARD_NOT_OWNED: { status: 400, message: 'Bạn không có lá bài này' },
  INVALID_COMBINATION: { status: 400, message: 'Các lá đã chọn không tạo thành bộ hợp lệ' },
  CANNOT_BEAT_CURRENT_PLAY: { status: 409, message: 'Bộ này không chặn được bài trên bàn' },
  NOT_ADMIN: { status: 403, message: 'Bạn không có quyền quản trị' },
  BALANCE_NEGATIVE: { status: 409, message: 'Không thể trừ quá số điểm hiện có' },
  TURN_NOT_EXPIRED: { status: 409, message: 'Chưa hết thời gian lượt' },
  INTERNAL_ERROR: { status: 500, message: 'Có lỗi xảy ra, vui lòng thử lại' },
} as const satisfies Record<string, { status: number; message: string }>

export type ApiErrorCode = keyof typeof API_ERRORS

// Every engine code must be an API code (checked at compile time and in tests).
type _EngineCodesAreApiCodes = MoveErrorCode extends ApiErrorCode ? true : never
export const ENGINE_CODES_ARE_API_CODES: _EngineCodesAreApiCodes = true
void MOVE_ERROR_CODES

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.hasOwn(API_ERRORS, value)
}

export interface ErrorEnvelope {
  ok: false
  error: { code: ApiErrorCode; message: string }
}

export function errorEnvelope(code: ApiErrorCode): ErrorEnvelope {
  return { ok: false, error: { code, message: API_ERRORS[code].message } }
}

/** Constraint name → code, for unique violations that are expected under races. */
const CONSTRAINT_CODES: Record<string, ApiErrorCode> = {
  game_actions_match_action_key: 'ACTION_ALREADY_PROCESSED',
  game_actions_match_version_key: 'VERSION_CONFLICT',
  room_players_one_active_room_key: 'ALREADY_IN_ROOM',
  room_players_active_member_key: 'ALREADY_IN_ROOM',
  room_players_active_seat_key: 'VERSION_CONFLICT',
  room_players_role_seat: 'INTERNAL_ERROR',
  matches_one_playing_per_room: 'MATCH_IN_PROGRESS',
}

/**
 * Maps a PostgREST/Postgres error from an RPC call to an API code.
 * - P0001 with a known code as the message (our RAISE EXCEPTION) → that code.
 * - 23505 unique violation on a known constraint → its code.
 * - Anything else → INTERNAL_ERROR (details stay in the function logs).
 */
export function mapDbError(error: { code?: string; message?: string; details?: string } | null | undefined): ApiErrorCode {
  if (!error) return 'INTERNAL_ERROR'
  const message = (error.message ?? '').trim()
  if (error.code === 'P0001' && isApiErrorCode(message)) return message
  if (error.code === '23505') {
    const text = `${message} ${error.details ?? ''}`
    for (const [constraint, code] of Object.entries(CONSTRAINT_CODES)) if (text.includes(constraint)) return code
  }
  return 'INTERNAL_ERROR'
}

/** Thrown inside handlers; `http.ts` turns it into the envelope. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  constructor(code: ApiErrorCode) {
    super(code)
    this.name = 'ApiError'
    this.code = code
  }
}
