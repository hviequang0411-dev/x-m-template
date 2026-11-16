import type { CombinationType, MoveErrorCode } from '@engine'

export const COMBINATION_LABEL: Record<CombinationType, string> = {
  SINGLE: 'Lẻ',
  PAIR: 'Đôi',
  TRIPLE: 'Sám',
  STRAIGHT: 'Sảnh',
  FOUR_OF_A_KIND: 'Tứ quý',
}

export const MOVE_ERROR_MESSAGE: Record<MoveErrorCode, string> = {
  INVALID_REQUEST: 'Yêu cầu không hợp lệ',
  MATCH_NOT_ACTIVE: 'Ván đã kết thúc',
  NOT_YOUR_TURN: 'Chưa đến lượt bạn',
  CARD_NOT_OWNED: 'Bạn không có lá bài này',
  INVALID_COMBINATION: 'Các lá đã chọn không tạo thành bộ hợp lệ',
  CANNOT_BEAT_CURRENT_PLAY: 'Bộ này không chặn được bài trên bàn',
  LEADER_CANNOT_PASS: 'Bạn đang dẫn vòng nên không được bỏ lượt',
}
