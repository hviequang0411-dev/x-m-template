/**
 * Maps Supabase Auth errors to user-facing Vietnamese messages without
 * echoing raw server text (which can contain internal details).
 */
export function authErrorMessage(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return 'Đã xảy ra lỗi. Vui lòng thử lại.'
  const code = error.code ?? ''
  const msg = (error.message ?? '').toLowerCase()

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
    return 'Email hoặc mật khẩu không đúng'
  if (code === 'user_already_exists' || msg.includes('already registered'))
    return 'Email này đã được đăng ký'
  if (code === 'email_not_confirmed') return 'Vui lòng xác nhận email trước khi đăng nhập'
  if (code === 'weak_password') return 'Mật khẩu quá yếu'
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit')
    return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.'
  // The profile trigger rejects duplicate/invalid usernames; GoTrue surfaces that generically.
  if (code === 'unexpected_failure' || msg.includes('database error saving new user'))
    return 'Tên đăng nhập đã tồn tại hoặc không hợp lệ'
  return 'Đã xảy ra lỗi. Vui lòng thử lại.'
}
